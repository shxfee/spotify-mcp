import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpotifyClient } from '../client.js';
import type {
  SpotifyTrack,
  SpotifyArtistFull,
  SpotifyArtistSimple,
  SpotifyPaged,
  RecentlyPlayedResponse,
  FeaturedPlaylistsResponse,
  SearchResponse,
} from '../types/spotify.js';
import { GENRE_SEEDS } from '../genres.js';

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const timeRangeSchema = z
  .enum(['short_term', 'medium_term', 'long_term'])
  .optional()
  .describe('~4 weeks / ~6 months / all time. Default: medium_term');

const limitSchema = (max = 50) =>
  z.number().int().min(1).max(max).optional().describe(`1–${max}. Default: 20`);

// Audio attribute tuning — min/max/target for each float + int attribute.
// Spotify retired the audio-features endpoint, so these can no longer be
// applied; get_recommendations keeps them for backward compatibility only.
// FLOAT_ATTRS + INT_ATTRS are the single source for both the request schema
// and the "was tuning requested?" check below — keep them here, not inlined.
const FLOAT_ATTRS = [
  'acousticness',
  'danceability',
  'energy',
  'instrumentalness',
  'liveness',
  'loudness',
  'speechiness',
  'tempo',
  'valence',
] as const;

const INT_ATTRS = ['duration_ms', 'key', 'mode', 'time_signature'] as const;

/** Every tuning param name (min/max/target × each attribute). */
const TUNING_KEYS: string[] = [...FLOAT_ATTRS, ...INT_ATTRS].flatMap((attr) =>
  ['min', 'max', 'target'].map((prefix) => `${prefix}_${attr}`),
);

/** Zod fragment for all tuning params — all optional, ints where appropriate. */
function audioTuningSchema(): Record<string, z.ZodOptional<z.ZodNumber>> {
  const schema: Record<string, z.ZodOptional<z.ZodNumber>> = {};
  for (const attr of FLOAT_ATTRS) {
    for (const prefix of ['min', 'max', 'target'] as const) {
      schema[`${prefix}_${attr}`] = z.number().optional();
    }
  }
  for (const attr of INT_ATTRS) {
    for (const prefix of ['min', 'max', 'target'] as const) {
      schema[`${prefix}_${attr}`] = z.number().int().optional();
    }
  }
  return schema;
}

/** Fisher-Yates shuffle (in-place). */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Maximum results Spotify search returns per request (enforced server-side). */
const SEARCH_PAGE_LIMIT = 10;

/**
 * Search Spotify for tracks matching a query and return up to `desired` results.
 * Makes multiple paginated requests (10 per page) with a randomised starting
 * offset to introduce variety across calls.
 */
async function searchTracks(
  client: SpotifyClient,
  query: string,
  desired: number,
  market?: string,
): Promise<SpotifyTrack[]> {
  const startOffset = Math.floor(Math.random() * 40);
  const pages = Math.ceil(desired / SEARCH_PAGE_LIMIT);
  const all: SpotifyTrack[] = [];

  for (let page = 0; page < pages; page++) {
    const params: Record<string, string> = {
      q: query,
      type: 'track',
      limit: String(SEARCH_PAGE_LIMIT),
      offset: String(startOffset + page * SEARCH_PAGE_LIMIT),
    };
    if (market) params.market = market;

    const result = await client.get<SearchResponse>('/search', params);
    const tracks = (result?.tracks?.items?.filter(Boolean) as SpotifyTrack[]) ?? [];
    all.push(...tracks);
    // Stop early if Spotify returned fewer than a full page
    if (tracks.length < SEARCH_PAGE_LIMIT) break;
  }

  return all;
}

export function registerPersonalizationTools(server: McpServer, client: SpotifyClient): void {
  // get_top_tracks
  server.tool(
    'get_top_tracks',
    "Get the user's most-played tracks",
    {
      time_range: timeRangeSchema,
      limit: limitSchema(50),
    },
    async (args) => {
      const params: Record<string, string> = {
        time_range: args.time_range ?? 'medium_term',
        limit: String(args.limit ?? 20),
      };
      const result = await client.get<SpotifyPaged<SpotifyTrack>>('/me/top/tracks', params);
      if (!result) throw new Error('Could not retrieve top tracks');

      const lines = [`Top tracks (${result.total} total, showing ${result.items.length}):`];
      result.items.forEach((track, i) => {
        const artists = track.artists.map((a) => a.name).join(', ');
        lines.push(
          `  ${i + 1}. "${track.name}" by ${artists} (${formatDuration(track.duration_ms)}) | URI: ${track.uri}`,
        );
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // get_top_artists
  server.tool(
    'get_top_artists',
    "Get the user's most-played artists",
    {
      time_range: timeRangeSchema,
      limit: limitSchema(50),
    },
    async (args) => {
      const params: Record<string, string> = {
        time_range: args.time_range ?? 'medium_term',
        limit: String(args.limit ?? 20),
      };
      const result = await client.get<SpotifyPaged<SpotifyArtistFull>>('/me/top/artists', params);
      if (!result) throw new Error('Could not retrieve top artists');

      const lines = [`Top artists (${result.total} total, showing ${result.items.length}):`];
      result.items.forEach((artist, i) => {
        const genres = artist.genres.length ? artist.genres.join(', ') : 'no genres listed';
        lines.push(`  ${i + 1}. ${artist.name} — ${genres} | URI: ${artist.uri}`);
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // get_recently_played
  server.tool(
    'get_recently_played',
    'Get recently played tracks with timestamps',
    {
      limit: limitSchema(50),
      after: z
        .number()
        .int()
        .optional()
        .describe('Unix timestamp ms — return tracks played after this time'),
      before: z
        .number()
        .int()
        .optional()
        .describe('Unix timestamp ms — return tracks played before this time'),
    },
    async (args) => {
      const params: Record<string, string> = { limit: String(args.limit ?? 20) };
      if (args.after !== undefined) params.after = String(args.after);
      if (args.before !== undefined) params.before = String(args.before);

      const result = await client.get<RecentlyPlayedResponse>(
        '/me/player/recently-played',
        params,
      );
      if (!result) throw new Error('Could not retrieve recently played tracks');

      const lines = [`Recently played (${result.items.length} tracks):`];
      for (const item of result.items) {
        const artists = item.track.artists.map((a) => a.name).join(', ');
        const playedAt = new Date(item.played_at).toLocaleString();
        lines.push(
          `  • "${item.track.name}" by ${artists} — played at ${playedAt} | URI: ${item.track.uri}`,
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // get_recommendations
  //
  // Spotify retired the /recommendations endpoint (404 for new apps as of 2024).
  // This reimplementation uses search-based discovery:
  //   - seed_tracks → look up track to get artist names, search for those artists' tracks
  //   - seed_artists → look up artist name, search for artist:<name> tracks
  //   - seed_genres → search for genre:<genre> tracks
  // Results are collected, deduplicated, shuffled, and trimmed to the requested limit.
  //
  // Audio-attribute tuning params are accepted but ignored (audio-features endpoint
  // is also retired). A note in the output tells callers when tuning was requested
  // but could not be applied.
  server.tool(
    'get_recommendations',
    'Generate track recommendations from seed tracks/artists/genres. Total seeds (tracks + artists + genres) must be 1–5. Note: audio attribute tuning params are accepted for compatibility but cannot be applied (Spotify retired the audio-features endpoint).',
    {
      seed_tracks: z
        .array(z.string())
        .max(5)
        .optional()
        .describe('Up to 5 track IDs as recommendation seeds'),
      seed_artists: z
        .array(z.string())
        .max(5)
        .optional()
        .describe('Up to 5 artist IDs as recommendation seeds'),
      seed_genres: z
        .array(z.string())
        .max(5)
        .optional()
        .describe('Up to 5 genre strings (from get_available_genres) as recommendation seeds'),
      limit: limitSchema(100),
      market: z.string().optional().describe('ISO 3166-1 alpha-2 country code'),
      // Tuning params kept for backward compatibility — silently ignored
      // (Spotify retired audio-features). Generated from FLOAT_ATTRS/INT_ATTRS.
      ...audioTuningSchema(),
    },
    async (args) => {
      const totalSeeds =
        (args.seed_tracks?.length ?? 0) +
        (args.seed_artists?.length ?? 0) +
        (args.seed_genres?.length ?? 0);
      if (totalSeeds < 1 || totalSeeds > 5) {
        throw new Error(
          `Total seeds must be between 1 and 5, got ${totalSeeds}. Provide seed_tracks, seed_artists, and/or seed_genres.`,
        );
      }

      const desired = args.limit ?? 20;
      // Fetch more candidates than needed so we can shuffle and deduplicate
      const perQuery = Math.min(50, Math.max(10, Math.ceil((desired * 3) / totalSeeds)));
      const candidates: SpotifyTrack[] = [];
      const seedTrackIds = new Set<string>(args.seed_tracks ?? []);

      // --- seed_tracks: look up each track's artists, search for their music ---
      if (args.seed_tracks?.length) {
        for (const trackId of args.seed_tracks) {
          const track = await client.get<SpotifyTrack>(
            `/tracks/${encodeURIComponent(trackId)}`,
          );
          if (!track) continue;
          // Search by the primary artist name
          const artistName = track.artists[0]?.name;
          if (artistName) {
            const found = await searchTracks(
              client,
              `artist:"${artistName}"`,
              perQuery,
              args.market,
            );
            candidates.push(...found);
          }
        }
      }

      // --- seed_artists: look up artist name, search for their tracks ---
      if (args.seed_artists?.length) {
        for (const artistId of args.seed_artists) {
          const artist = await client.get<{ id: string; name: string }>(
            `/artists/${encodeURIComponent(artistId)}`,
          );
          if (!artist) continue;
          const found = await searchTracks(
            client,
            `artist:"${artist.name}"`,
            perQuery,
            args.market,
          );
          candidates.push(...found);
        }
      }

      // --- seed_genres: search by genre ---
      if (args.seed_genres?.length) {
        for (const genre of args.seed_genres) {
          const found = await searchTracks(
            client,
            `genre:"${genre}"`,
            perQuery,
            args.market,
          );
          candidates.push(...found);
        }
      }

      // Deduplicate by track ID, exclude seed tracks themselves
      const seen = new Set<string>();
      const unique: SpotifyTrack[] = [];
      for (const track of candidates) {
        if (!track.id || seen.has(track.id) || seedTrackIds.has(track.id)) continue;
        seen.add(track.id);
        unique.push(track);
      }

      // Shuffle for variety, then trim to limit
      shuffle(unique);
      const tracks = unique.slice(0, desired);

      if (tracks.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'No recommendations found for the given seeds. Try different seed tracks, artists, or genres.',
            },
          ],
        };
      }

      // Check whether any tuning params were supplied (same source as the schema)
      const hasTuning = TUNING_KEYS.some((k) => (args as Record<string, unknown>)[k] !== undefined);

      const lines: string[] = [];
      if (hasTuning) {
        lines.push(
          'Note: Audio attribute tuning was requested but could not be applied (Spotify retired the audio-features endpoint). Results are unfiltered.',
          '',
        );
      }
      lines.push(`Recommended tracks (${tracks.length}):`);
      tracks.forEach((track, i) => {
        const artists = track.artists.map((a: SpotifyArtistSimple) => a.name).join(', ');
        lines.push(
          `  ${i + 1}. "${track.name}" by ${artists} — ${track.album.name} (${formatDuration(track.duration_ms)}) | URI: ${track.uri}`,
        );
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // get_available_genres
  server.tool(
    'get_available_genres',
    'Get the list of genre strings usable as recommendation seeds',
    {},
    async () => {
      return {
        content: [
          {
            type: 'text',
            text: `Available genre seeds (${GENRE_SEEDS.length}):\n${GENRE_SEEDS.join(', ')}`,
          },
        ],
      };
    },
  );

  // get_featured_playlists
  server.tool(
    'get_featured_playlists',
    "Get Spotify's editorially curated featured playlists",
    {
      locale: z
        .string()
        .optional()
        .describe('BCP 47 language tag (e.g. "en_US") for localized names'),
      limit: limitSchema(50),
      offset: z.number().int().min(0).optional().describe('Pagination offset. Default: 0'),
    },
    async (args) => {
      const params: Record<string, string> = { limit: String(args.limit ?? 20) };
      if (args.locale) params.locale = args.locale;
      if (args.offset !== undefined) params.offset = String(args.offset);

      const result = await client.get<FeaturedPlaylistsResponse>(
        '/browse/featured-playlists',
        params,
      );
      if (!result) throw new Error('Could not retrieve featured playlists');

      const lines = [
        result.message,
        `Featured playlists (${result.playlists.total} total, showing ${result.playlists.items.length}):`,
      ];
      for (const pl of result.playlists.items) {
        if (!pl) continue;
        const owner = pl.owner?.display_name ?? pl.owner?.id ?? 'Unknown';
        const desc = pl.description ? ` — ${pl.description}` : '';
        lines.push(
          `  • "${pl.name}" by ${owner}${desc} (${pl.tracks?.total ?? 0} tracks) | URI: ${pl.uri}`,
        );
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );
}
