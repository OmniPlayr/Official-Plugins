# soundcloud@built-in

Play SoundCloud tracks inside OmniPlayr and expose SoundCloud playlists to `playlists@built-in`.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/soundcloud@built-in](https://omniplayr.wokki20.nl/packages/package/soundcloud@built-in)**

---

## What it does

Once connected to your SoundCloud account, `soundcloud@built-in` will:

- Add SoundCloud as an OmniPlayr playback source
- Play public SoundCloud track URLs without a SoundCloud app or Pro account
- Play SoundCloud tracks through the official SoundCloud HTML5 Widget API
- Fetch track metadata from the SoundCloud API
- Authenticate with SoundCloud using OAuth and PKCE
- Refresh access tokens automatically
- Expose SoundCloud playlists and playlist songs to other backend plugins
- Add **Connect Account / Log Out** entries to the plugins menu

Public SoundCloud URLs work in basic mode without SoundCloud OAuth. Private playlists, account playlists, and numeric SoundCloud track IDs require the user to authenticate with SoundCloud.

---

## Requirements

- A public SoundCloud URL for basic playback
- A SoundCloud account for private playlists and account library access
- A SoundCloud developer app with a registered redirect URI for connected mode
- The app's **Client ID** and **Client Secret** for connected mode
- SoundCloud **Artist Pro** for app registration
- OmniPlayr served over HTTPS in production

SoundCloud's current developer documentation says app registration requires Artist Pro. That requirement is enforced by SoundCloud, not by OmniPlayr. Basic public URL playback does not use app registration. Connected mode uses OAuth, and SoundCloud's token endpoint requires the client secret during token exchange and refresh, so this plugin stores it per OmniPlayr account in the plugin database.

---

## Setup

### Basic public playback

No SoundCloud app is needed for public URL playback. Queue a public SoundCloud URL with source type `soundcloud`; the frontend loads it through SoundCloud's embeddable widget and uses oEmbed metadata when available.

### Connected mode

1. Go to [https://soundcloud.com/you/apps](https://soundcloud.com/you/apps) and create or open a SoundCloud app.
2. In the app settings, add this redirect URI:
   ```text
   https://<your-omniplayr-host>/api/plugin/soundcloud/callback
   ```
3. Copy the app's **Client ID** and **Client Secret**.
4. In OmniPlayr, open the plugins menu and click **Connect Account** under SoundCloud.
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
oembed_base_url = "https://soundcloud.com/oembed"

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
| `api.oembed_base_url` | Base URL for public SoundCloud oEmbed metadata requests |
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

Numeric track IDs require connected mode. Public SoundCloud URLs can be resolved with `POST /soundcloud/track`.

### `POST /soundcloud/track`

Resolves a SoundCloud song ID or public SoundCloud URL.

```json
{ "song_id": "https://soundcloud.com/artist/track" }
```

Public URLs do not require SoundCloud app credentials.

### `DELETE /soundcloud/disconnect`

Clears stored SoundCloud tokens for the current account while keeping the app credentials.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
