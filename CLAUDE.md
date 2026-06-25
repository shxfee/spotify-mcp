# SpotifyMCP — Claude Code Rules

You are helping build an MCP server that wraps the Spotify Web API. Follow these rules at all times.

## Spotify API Reference

Always refer to the official Spotify OpenAPI specification for endpoint paths, parameters, and response schemas:

- **OpenAPI schema**: https://developer.spotify.com/reference/web-api/open-api-schema.yaml
- **API reference**: https://developer.spotify.com/documentation/web-api/reference

Do not guess endpoint paths, query parameter names, or response field names. Look them up.

## Authorization

- Use **Authorization Code with PKCE** for all user-specific data (the standard flow for this MCP server).
  - Reference: https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow
- The **Authorization Code flow** (with client secret on a secure backend) is also acceptable if a backend component is added.
  - Reference: https://developer.spotify.com/documentation/web-api/tutorials/code-flow
- Use **Client Credentials** only for non-user, public catalog data (no user context).
- **Never use the Implicit Grant flow** — it is deprecated by Spotify.

## Redirect URIs

- Always use `https://` redirect URIs in production.
- For local development, use `http://127.0.0.1` (not `http://localhost`).
- Never use wildcard URIs.
- Reference: https://developer.spotify.com/documentation/web-api/concepts/redirect_uri

## OAuth Scopes

- Request only the **minimum scopes** required for the feature being built.
- Do not request broad scopes preemptively "just in case."
- Reference: https://developer.spotify.com/documentation/web-api/concepts/scopes

## Token Management

- Store tokens securely (local file with restricted permissions, never in source control).
- **Never expose the Client Secret in client-side or committed code.**
- Always implement token refresh so the app does not break when access tokens expire (they expire after 1 hour).
- Reference: https://developer.spotify.com/documentation/web-api/tutorials/refreshing-tokens

## Rate Limiting

- On HTTP **429 Too Many Requests**: read the `Retry-After` header and wait that many seconds before retrying.
- Use **exponential backoff** for repeated failures.
- Never retry immediately in a tight loop.

## Deprecated Endpoints

Do not use deprecated endpoints. Prefer the current equivalents:

| Deprecated | Use instead |
|---|---|
| `GET/POST/DELETE /playlists/{id}/tracks` | `GET/POST/DELETE /playlists/{id}/items` |
| `PUT /me/tracks`, `PUT /me/albums`, etc. | `PUT /me/library` (unified) |
| `DELETE /me/tracks`, `DELETE /me/albums`, etc. | `DELETE /me/library` (unified) |
| `GET /me/tracks/contains`, `GET /me/albums/contains`, etc. | `GET /me/library/contains` (unified) |
| `PUT/DELETE /me/following` (type-specific) | `PUT /me/library` / `DELETE /me/library` |
| `GET /browse/categories` | Deprecated — avoid |
| `GET /browse/new-releases` | Removed — do not use |
| `GET /artists/{id}/top-tracks` | Removed — do not use |
| `GET /artists/{id}/related-artists` | Removed — do not use |
| `GET /recommendations` | Removed — use search-based discovery instead |
| `GET /recommendations/available-genre-seeds` | Removed — use static genre list in `src/genres.ts` |
| `GET /audio-features/{id}` | Removed — do not use |
| Batch `GET /albums`, `GET /artists`, `GET /episodes`, `GET /shows` | Removed — use individual ID endpoints |

## API Limits

- `GET /search` enforces a **maximum `limit` of 10** results per request (400 for higher values). Use paginated requests with `offset` to fetch more.
- Artist objects from `GET /artists/{id}` and search no longer include `genres`.

## Error Handling

- Handle all HTTP error codes documented in the OpenAPI schema.
- Read the `error.message` field from Spotify error responses and surface it meaningfully.
- Key codes to handle explicitly:
  - `401` — token expired, attempt refresh and retry once
  - `403` — forbidden (commonly: Premium required) — tell the user clearly
  - `404` — entity not found
  - `429` — rate limited — see rate limiting rules above
  - `503` — Spotify service unavailable — retry with backoff

## Developer Terms of Service

- Do not cache Spotify content beyond what is needed for immediate use.
- Always attribute content to Spotify where displayed.
- Do not use the API to train machine learning models on Spotify data.
- Reference: https://developer.spotify.com/terms
