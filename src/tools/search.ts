import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpotifyClient } from '../client.js';
import type { SearchResponse } from '../types/spotify.js';

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function registerSearchTools(server: McpServer, client: SpotifyClient): void {
  server.tool(
    'search',
    "Search Spotify's catalog for tracks, artists, albums, playlists, shows, or episodes",
    {
      query: z.string().describe('Search query'),
      types: z
        .array(z.enum(['track', 'artist', 'album', 'playlist', 'show', 'episode']))
        .optional()
        .describe('Content types to search. Default: ["track","artist","album"]'),
      limit: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe('Results per type, 1–10. Default: 5'),
      market: z.string().optional().describe('ISO 3166-1 alpha-2 country code'),
    },
    async (args) => {
      const types = args.types ?? ['track', 'artist', 'album'];
      const limit = args.limit ?? 5;

      const params: Record<string, string> = {
        q: args.query,
        type: types.join(','),
        limit: String(limit),
      };
      if (args.market) params.market = args.market;

      const results = await client.get<SearchResponse>('/search', params);
      if (!results) {
        return { content: [{ type: 'text', text: 'No results found.' }] };
      }

      const lines: string[] = [`Search results for "${args.query}":\n`];

      if (results.tracks?.items.length) {
        lines.push(`TRACKS (${results.tracks.total} total):`);
        for (const t of results.tracks.items) {
          if (!t) continue;
          const artists = t.artists?.map((a) => a.name).join(', ') ?? 'Unknown';
          lines.push(`  • "${t.name}" by ${artists} — ${t.album?.name ?? 'Unknown'} (${formatDuration(t.duration_ms)}) | URI: ${t.uri}`);
        }
        lines.push('');
      }

      if (results.artists?.items.length) {
        lines.push(`ARTISTS (${results.artists.total} total):`);
        for (const a of results.artists.items) {
          if (!a) continue;
          const genres = a.genres?.length ? ` — ${a.genres.slice(0, 3).join(', ')}` : '';
          lines.push(`  • ${a.name}${genres} | URI: ${a.uri}`);
        }
        lines.push('');
      }

      if (results.albums?.items.length) {
        lines.push(`ALBUMS (${results.albums.total} total):`);
        for (const al of results.albums.items) {
          if (!al) continue;
          const artists = al.artists?.map((a) => a.name).join(', ') ?? 'Unknown';
          lines.push(`  • "${al.name}" by ${artists} (${al.release_date ?? 'unknown'}, ${al.total_tracks ?? 0} tracks) | URI: ${al.uri}`);
        }
        lines.push('');
      }

      if (results.playlists?.items.length) {
        lines.push(`PLAYLISTS (${results.playlists.total} total):`);
        for (const p of results.playlists.items) {
          if (!p) continue;
          const owner = p.owner?.display_name ?? p.owner?.id ?? 'Unknown';
          lines.push(`  • "${p.name}" by ${owner} (${p.tracks?.total ?? 0} tracks) | URI: ${p.uri}`);
        }
        lines.push('');
      }

      if (results.shows?.items.length) {
        lines.push(`SHOWS (${results.shows.total} total):`);
        for (const s of results.shows.items) {
          if (!s) continue;
          lines.push(`  • "${s.name}" by ${s.publisher ?? 'Unknown'} (${s.total_episodes ?? 0} episodes) | URI: ${s.uri}`);
        }
        lines.push('');
      }

      if (results.episodes?.items.length) {
        lines.push(`EPISODES (${results.episodes.total} total):`);
        for (const e of results.episodes.items) {
          if (!e) continue;
          lines.push(`  • "${e.name}" — ${e.show?.name ?? 'Unknown'} (${formatDuration(e.duration_ms)}, ${e.release_date ?? 'unknown'}) | URI: ${e.uri}`);
        }
        lines.push('');
      }

      const output = lines.join('\n').trim();
      return { content: [{ type: 'text', text: output || 'No results found.' }] };
    },
  );
}
