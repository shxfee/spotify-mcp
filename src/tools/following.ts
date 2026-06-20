import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SpotifyClient } from '../client.js';
import type { FollowedArtistsResponse } from '../types/spotify.js';

export function registerFollowingTools(server: McpServer, client: SpotifyClient): void {
  // follow_artist
  server.tool(
    'follow_artist',
    'Follow one or more artists. Max 40.',
    {
      ids: z.array(z.string()).min(1).max(40).describe('Spotify artist IDs to follow'),
    },
    async (args) => {
      // Follow now goes through the unified /me/library with artist URIs in the query string.
      const uris = args.ids.map((id) => `spotify:artist:${id}`).join(',');
      await client.put(`/me/library?uris=${uris}`);
      return { content: [{ type: 'text', text: `Now following ${args.ids.length} artist(s).` }] };
    },
  );

  // unfollow_artist
  server.tool(
    'unfollow_artist',
    'Unfollow one or more artists. Max 40.',
    {
      ids: z.array(z.string()).min(1).max(40).describe('Spotify artist IDs to unfollow'),
    },
    async (args) => {
      const uris = args.ids.map((id) => `spotify:artist:${id}`).join(',');
      await client.delete(`/me/library?uris=${uris}`);
      return {
        content: [{ type: 'text', text: `Unfollowed ${args.ids.length} artist(s).` }],
      };
    },
  );

  // get_followed_artists
  server.tool(
    'get_followed_artists',
    'Get all artists the user follows (cursor-based pagination)',
    {
      limit: z.number().int().min(1).max(50).optional().describe('1–50. Default: 20'),
      after: z
        .string()
        .optional()
        .describe('Artist ID cursor for pagination (from previous response)'),
    },
    async (args) => {
      const params: Record<string, string> = {
        type: 'artist',
        limit: String(args.limit ?? 20),
      };
      if (args.after) params.after = args.after;

      const result = await client.get<FollowedArtistsResponse>('/me/following', params);
      if (!result) throw new Error('Could not retrieve followed artists');

      const { artists } = result;
      const lines = [
        `Followed artists (${artists.total} total, showing ${artists.items.length}):`,
      ];
      for (const artist of artists.items) {
        const genres = artist.genres.length ? artist.genres.join(', ') : 'no genres listed';
        lines.push(`  • ${artist.name} — ${genres} | URI: ${artist.uri}`);
      }
      if (artists.cursors?.after) {
        lines.push(`\nNext page cursor: ${artists.cursors.after}`);
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  // check_following_artists
  server.tool(
    'check_following_artists',
    'Check if the user follows specific artists. Returns a boolean per ID. Max 50.',
    {
      ids: z.array(z.string()).min(1).max(50).describe('Spotify artist IDs to check'),
    },
    async (args) => {
      const uris = args.ids.map((id) => `spotify:artist:${id}`);
      const result = await client.get<boolean[]>('/me/library/contains', {
        uris: uris.join(','),
      });
      if (!result) throw new Error('Could not check following status');

      const lines = args.ids.map((id, i) => `  ${result[i] ? '✓' : '✗'} ${id}`);
      return { content: [{ type: 'text', text: `Following check:\n${lines.join('\n')}` }] };
    },
  );
}
