# soundcloud@built-in

Play SoundCloud tracks inside OmniPlayr and expose SoundCloud playlists to `playlists@built-in`.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/soundcloud@built-in](https://omniplayr.wokki20.nl/packages/package/soundcloud@built-in)**

---

## What it does

Once connected to your SoundCloud account, `soundcloud@built-in` will:

- Add SoundCloud as an OmniPlayr playback source
- Play SoundCloud tracks through the official SoundCloud HTML5 Widget API
- Fetch track metadata from the SoundCloud API
- Authenticate with SoundCloud using OAuth and PKCE
- Refresh access tokens automatically
- Expose SoundCloud playlists and playlist songs to other backend plugins
- Add a **Log In / Log Out** entry to the plugins menu

Private playlists require the user to authenticate with SoundCloud. Public playback still goes through SoundCloud's widget player in the browser.

---

## Requirements

- A SoundCloud account
- A SoundCloud developer app with a registered redirect URI
- The app's **Client ID** and **Client Secret**
- OmniPlayr served over HTTPS in production

SoundCloud's OAuth token endpoint requires the client secret during token exchange and refresh, so this plugin stores it per OmniPlayr account in the plugin database.

---

## Setup

1. Go to [https://developers.soundcloud.com](https://developers.soundcloud.com) and create or open a SoundCloud app.
2. In the app settings, add this redirect URI:
   ```text
   https://<your-omniplayr-host>/api/plugin/soundcloud/callback
   ```
3. Copy the app's **Client ID** and **Client Secret**.
4. In OmniPlayr, open the plugins menu and click **Log In** under SoundCloud.
5. Paste the credentials and complete the SoundCloud authorization flow.

For local development, OmniPlayr uses:

```text
http://localhost:<port>/api/plugin/soundcloud/callback
```

---

## Python Dependencies

| Package | Version |
|---------|---------|
| `requests` | `>=2.28` |

Used for SoundCloud OAuth, profile, playlist, and metadata requests.

---

## Configuration

The backend is configured via `api.toml`:

```toml
[api]
base_url = "https://api.soundcloud.com"
auth_base_url = "https://secure.soundcloud.com"

[requests]
timeout_seconds = 10

[cache]
playlist_ttl_seconds = 30

[oauth]
state_ttl_seconds = 600
```

| Key | Description |
|-----|-------------|
| `api.base_url` | Base URL for SoundCloud API requests |
| `api.auth_base_url` | Base URL for SoundCloud OAuth requests |
| `requests.timeout_seconds` | Timeout for SoundCloud API and OAuth requests |
| `cache.playlist_ttl_seconds` | In-memory playlist page cache TTL |
| `oauth.state_ttl_seconds` | Pending OAuth login state lifetime |

---

## Architecture

This plugin is full-stack.

| Layer | Responsibility |
|-------|----------------|
| Backend | OAuth PKCE flow, token storage, token refresh, SoundCloud API requests, playlist functions |
| Frontend | SoundCloud Widget API loading, OmniPlayr source plugin integration, setup UI |

### Cross-plugin functions

The backend exposes:

- `get_playlists(user_id, limit, offset, force_refresh, timeout_seconds)`
- `get_playlist(user_id, playlist_id, include_songs, timeout_seconds)`
- `iter_playlist_songs(user_id, playlist_id, page_size, max_pages, request_delay_ms, timeout_seconds, ...)`
- `get_metadata(user_id, song_id, timeout_seconds)`

`playlists@built-in` uses these functions when SoundCloud playlist support is enabled.

---

## API Endpoints

### `POST /soundcloud/setup`

Saves SoundCloud app credentials for the current account.

```json
{
  "client_id": "your_client_id",
  "client_secret": "your_client_secret"
}
```

### `GET /soundcloud/status`

Returns the current connection state for the authenticated account.

### `GET /soundcloud/auth/start`

Starts the SoundCloud OAuth flow and returns an authorization URL.

### `GET /soundcloud/callback`

OAuth redirect target. Exchanges the authorization code for tokens and redirects back to OmniPlayr.

### `GET /soundcloud/track/{track_id}`

Returns a SoundCloud track URL and normalized metadata for browser playback.

### `DELETE /soundcloud/disconnect`

Clears stored SoundCloud tokens for the current account while keeping the app credentials.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
