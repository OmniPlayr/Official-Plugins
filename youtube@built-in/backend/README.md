# youtube@built-in

Listen to YouTube Music tracks inside OmniPlayr and expose YouTube Music playlists to `playlists@built-in`.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/youtube@built-in](https://omniplayr.wokki20.nl/packages/package/youtube@built-in)**

---

## What it does

Once connected to your Google account, `youtube@built-in` will:

- Add YouTube Music as an OmniPlayr playback source
- Stream YouTube Music audio through `yt-dlp`
- Fetch YouTube Music metadata through `ytmusicapi`
- Authenticate with Google using the TV and limited-input device OAuth flow
- Refresh access tokens automatically through `ytmusicapi`
- Expose YouTube Music playlists and playlist songs to other backend plugins
- Add **Connect Account / Log Out** entries to the plugins menu

Public YouTube Music tracks can be streamed by ID. Account playlists require the user to authenticate with Google.

---

## Requirements

- A Google account with YouTube Music access
- A Google Cloud project with **YouTube Data API v3** enabled
- An OAuth client ID configured as **TVs and Limited Input devices**
- The OAuth client's **Client ID** and **Client Secret**

Google requires a custom OAuth client for `ytmusicapi` OAuth connections. The credentials are stored per OmniPlayr account in the plugin database. The backend also writes a ytmusicapi-compatible OAuth token file per account so token refreshes can be persisted.

---

## Setup

1. Go to [https://console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials) and create or open a Google Cloud project.
2. Open the [YouTube Data API v3 page](https://console.cloud.google.com/apis/library/youtube.googleapis.com) and click **Enable** for the project. Playlist setup cannot discover your YouTube channel until this API is enabled.
3. Open the [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent), configure the app name and support/contact details that Google will show during login, and save it.
4. If the app is in testing mode, add your own Google account under **Test users**.
5. Create an OAuth client ID and choose **TVs and Limited Input devices** as the application type.
6. Copy the OAuth **Client ID** and **Client Secret**.
7. In OmniPlayr, open the plugins menu and click **Connect Account** under YouTube.
8. Paste the credentials, start the login flow, and enter the displayed device code on Google's device login page.

---

## Configuration

The plugin is configured via `settings.toml`:

```toml
[oauth]
cache_dir = "user_storage/youtube-oauth"
```

| Key | Description |
|-----|-------------|
| `oauth.cache_dir` | Directory used for per-account ytmusicapi OAuth JSON files |

OAuth tokens are stored in the database and mirrored to `account-{id}.oauth.json` inside `oauth.cache_dir` when YouTube Music API calls are made.

---

## Python Dependencies

| Package | Version |
|---------|---------|
| `ytmusicapi` | `==1.12.1` |
| `yt_dlp` | `==2026.6.9` |
| `starlette` | `==0.37.2` |
| `requests` | `>=2.28` |

`ytmusicapi` is used for authenticated YouTube Music API calls. `yt-dlp` resolves playable audio streams for the OmniPlayr player.

---

## Architecture

This plugin is full-stack.

| Layer | Responsibility |
|-------|----------------|
| Backend | OAuth device flow, token storage, YouTube Music API requests, API v3 channel discovery, playlist functions, audio stream resolution |
| Frontend | Setup UI, device-code approval flow, plugins menu account controls |

### Cross-plugin functions

The backend exposes:

- `get_playlists(user_id, limit, offset, force_refresh, timeout_seconds)`
- `get_playlist(user_id, playlist_id, include_songs, timeout_seconds)`
- `iter_playlist_songs(user_id, playlist_id, page_size, max_pages, request_delay_ms, timeout_seconds, ...)`
- `get_metadata(user_id, song_id, timeout_seconds)`

`playlists@built-in` uses these functions when YouTube Music playlist support is enabled.

---

## API Endpoints

### `POST /youtube/setup`

Saves Google OAuth credentials for the current account.

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret"
}
```

### `GET /youtube/status`

Returns the current connection state for the authenticated account.

### `POST /youtube/auth/start`

Starts the Google device login flow and returns a verification URL plus user code.

### `POST /youtube/auth/poll`

Polls the active device login flow until Google returns OAuth tokens.

```json
{ "flow_id": "device_code_from_start" }
```

### `DELETE /youtube/disconnect`

Clears stored YouTube tokens for the current account while keeping the OAuth credentials.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
