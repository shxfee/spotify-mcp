# SpotifyMCP

An MCP server that wraps the Spotify Web API, letting AI assistants (like Claude) create and manage playlists, search for music, control playback, and get personalized recommendations.

## Quick setup

### 1. Create a Spotify app

Each user needs their own Spotify app to get a Client ID — this is how Spotify identifies which app is making API requests.

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) and create a new app.
2. In the app settings, add the following **Redirect URI** exactly (Spotify will reject the login if this doesn't match):
   ```
   http://127.0.0.1:8888/callback
   ```
3. Save. Copy your **Client ID**.

### 2. Authenticate

Run the command below once to log in to your Spotify account. Replace `your_client_id_here` with the Client ID from step 1. It opens a browser window, and after you approve, saves tokens to `~/.spotify-mcp/tokens.json`. The server refreshes them automatically — you won't need to do this again.

**macOS / Linux:**
```bash
SPOTIFY_CLIENT_ID=your_client_id_here npx spotify-mcp@latest auth
```

**Windows (Command Prompt):**
```cmd
set SPOTIFY_CLIENT_ID=your_client_id_here && npx spotify-mcp@latest auth
```

**Windows (PowerShell):**
```powershell
$env:SPOTIFY_CLIENT_ID="your_client_id_here"; npx spotify-mcp@latest auth
```

### 3. Configure Claude Desktop

Open your `claude_desktop_config.json`:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** Open Claude Desktop → Settings → Developer → Edit Config

Add the `mcpServers` block (replace `your_client_id_here` with your Client ID):

```json
{
  "mcpServers": {
    "spotify": {
      "command": "npx",
      "args": ["-y", "spotify-mcp@latest"],
      "env": {
        "SPOTIFY_CLIENT_ID": "your_client_id_here"
      }
    }
  }
}
```

Fully quit and restart Claude Desktop. A hammer icon in the chat input confirms the server is connected.

## Usage

Once connected, you can ask Claude things like:

- "What are my top Spotify tracks?"
- "Create a playlist of chill lo-fi songs for studying"
- "Add the song Blinding Lights to my workout playlist"
- "What artists have I been listening to most lately?"
- "Make me a playlist with a late night driving vibe"

## Disclaimer

This is a personal project, not affiliated with or endorsed by Spotify. It is provided as-is with no warranties or guarantees of any kind. Use it responsibly and in accordance with the [Spotify Developer Terms of Service](https://developer.spotify.com/terms). The author is not responsible for any misuse or consequences arising from use of this software.

## Development

```bash
git clone https://github.com/calebWei/SpotifyMCP.git
cd SpotifyMCP
npm install
npm run build
```

Copy `.env.example` to `.env` and fill in your Client ID, then:

```bash
npm run auth   # authenticate with Spotify
npm run dev    # run from source (no build needed)
```

## Fork notes (shxfee/spotify-mcp)

Forked from [calebWei/SpotifyMCP](https://github.com/calebWei/SpotifyMCP) and patched for Spotify's Feb-2026 Web API changes:

- The unified `/me/library` write endpoints (`save_items`, `remove_saved_items`, `follow_artist`, `unfollow_artist`) take `uris` in the **query string**, not the JSON body. The upstream code sent them in the body, which returns `400 Missing required field: uris`. Fixed to use the query string.
- Following/unfollowing artists now routes through `/me/library` with `spotify:artist:<id>` URIs (the type-specific `/me/following` write endpoints were removed).

Also note: the app must be allowlisted (Dashboard → User Management) — un-allowlisted users get `403` on writes even with valid tokens.
