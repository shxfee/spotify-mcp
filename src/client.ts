import { loadTokens, saveTokens } from './auth.js';
import type { TokenData } from './types/spotify.js';

const BASE_URL = 'https://api.spotify.com/v1';

export class SpotifyApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read a successful response body as JSON, tolerating the cases Spotify
 * actually returns: 204 No Content, an empty body, or a non-JSON body.
 *
 * Notably POST /me/player/queue replies 200 with an opaque, non-JSON
 * tracking token (~27 bytes) — calling res.json() on it throws. Endpoints
 * with no meaningful payload return null instead of erroring.
 */
async function parseJsonBody<T>(res: Response): Promise<T | null> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export class SpotifyClient {
  private tokens: TokenData | null = null;
  private loadPromise: Promise<TokenData> | null = null;

  // Rate limiting
  private _queue: Promise<unknown> = Promise.resolve();
  private _lastRequestTime = 0;
  private _rateLimitUntil = 0;

  private getTokens(): Promise<TokenData> {
    if (this.tokens) return Promise.resolve(this.tokens);
    if (!this.loadPromise) {
      this.loadPromise = loadTokens().then((t) => {
        this.tokens = t;
        return t;
      });
    }
    return this.loadPromise;
  }

  private async ensureValidToken(): Promise<void> {
    const tokens = await this.getTokens();
    if (Date.now() >= tokens.expires_at - 60_000) {
      await this.doRefreshTokens();
    }
  }

  private async doRefreshTokens(): Promise<void> {
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!clientId) throw new Error('SPOTIFY_CLIENT_ID environment variable is not set');

    const tokens = this.tokens!;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    });

    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new SpotifyApiError(res.status, 'Token refresh failed — re-run "spotify-mcp auth"');
    }

    const data = await res.json() as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    this.tokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token ?? tokens.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    await saveTokens(this.tokens);
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const promise = this._queue.then(async () => {
      const now = Date.now();
      const rateLimitWait = Math.max(0, this._rateLimitUntil - now);
      const gapWait = Math.max(0, this._lastRequestTime + 100 - now);
      const waitMs = Math.max(rateLimitWait, gapWait);
      if (waitMs > 0) await sleep(waitMs);
      this._lastRequestTime = Date.now();
      return fn();
    });
    // Prevent a rejected promise from poisoning the queue chain
    this._queue = promise.catch(() => undefined);
    return promise;
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const url = `${BASE_URL}${path}`;
    if (!params || Object.keys(params).length === 0) return url;
    return `${url}?${new URLSearchParams(params)}`;
  }

  private async rawRequest(
    method: string,
    url: string,
    body?: unknown,
    retryCount = 0,
  ): Promise<Response> {
    await this.ensureValidToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.tokens!.access_token}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Token expired mid-flight — refresh and retry once
    if (res.status === 401 && retryCount === 0) {
      await this.doRefreshTokens();
      return this.rawRequest(method, url, body, retryCount + 1);
    }

    // Rate limited — wait and retry once
    if (res.status === 429 && retryCount === 0) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '1', 10);
      this._rateLimitUntil = Date.now() + retryAfter * 1000;
      await sleep(retryAfter * 1000);
      return this.rawRequest(method, url, body, retryCount + 1);
    }

    if (!res.ok) {
      let message = `Spotify API error ${res.status}`;
      if (res.status === 403) {
        message = 'This action requires Spotify Premium';
      } else if (res.status === 404) {
        message = 'The requested resource was not found on Spotify';
      } else if (res.status === 503) {
        message = 'Spotify service is temporarily unavailable — try again shortly';
      } else {
        try {
          const err = await res.json() as { error?: { message?: string } };
          if (err.error?.message) message = err.error.message;
        } catch { /* ignore JSON parse failures */ }
      }
      throw new SpotifyApiError(res.status, message);
    }

    return res;
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T | null> {
    const url = this.buildUrl(path, params);
    return this.enqueue(async () => {
      const res = await this.rawRequest('GET', url);
      return parseJsonBody<T>(res);
    });
  }

  async post<T>(path: string, body?: unknown): Promise<T | null> {
    const url = this.buildUrl(path);
    return this.enqueue(async () => {
      const res = await this.rawRequest('POST', url, body);
      return parseJsonBody<T>(res);
    });
  }

  async put(path: string, body?: unknown): Promise<void> {
    const url = this.buildUrl(path);
    await this.enqueue(() => this.rawRequest('PUT', url, body));
  }

  async delete(path: string, body?: unknown): Promise<void> {
    const url = this.buildUrl(path);
    await this.enqueue(() => this.rawRequest('DELETE', url, body));
  }
}
