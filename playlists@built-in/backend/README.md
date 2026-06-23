# playlists@built-in

Create, list, and stream playlist data inside OmniPlayr. This plugin manages local OmniPlayr playlists and can also surface Spotify playlists when `spotify@built-in` is installed and connected.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/playlists@built-in](https://omniplayr.wokki20.nl/packages/package/playlists@built-in)**

---

## What it does

Once enabled, `playlists@built-in` will:

- Create a private **Liked Songs** playlist for each account when needed
- List local OmniPlayr playlists, including owner and creator details
- Stream playlist collections incrementally using NDJSON responses
- Stream songs from individual local playlists
- Integrate with `spotify@built-in` to show Spotify playlists beside local playlists
- Cache Spotify playlist summaries, details, and song lists to reduce repeated API work
- Respect private playlist visibility so users only see private playlists they own

Local playlists are stored in OmniPlayr's plugin database tables. Spotify playlists are read through the Spotify plugin and cached on disk.

---

## Requirements

- OmniPlayr account authentication
- `spotify@built-in` installed and connected if Spotify playlists should appear

Spotify playlist support is optional. If Spotify is unavailable, local playlists continue to work.

---

## Configuration

The plugin is configured via `settings.toml`:

```toml
[cache]
enabled = true
cache_dir = "user_storage/playlist-cache"
refresh_in_background = true
song_ttl_seconds = 300

[streaming]
enabled = true

[providers]
default_services = "local,spotify"
check_spotify_playlists = true

[spotify]
load_all_playlists = true
request_page_size = 50
display_batch_size = 10
display_batch_delay_ms = 50
max_playlist_pages = 100
song_page_size = 50
song_display_batch_size = 20
song_display_batch_delay_ms = 10
song_request_delay_ms = 250
max_song_pages = 100

[pagination]
default_limit = 40
default_offset = 0
max_limit = 50

[requests]
timeout_seconds = 10
```

| Key | Description |
|-----|-------------|
| `cache.enabled` | Cache playlist responses as JSON |
| `cache.cache_dir` | Directory used for playlist cache files |
| `cache.refresh_in_background` | Refresh cached Spotify data in the background |
| `streaming.enabled` | Enable incremental NDJSON playlist responses |
| `providers.default_services` | Comma-separated default services, such as `local,spotify` |
| `providers.check_spotify_playlists` | Include Spotify when loading playlist collections |
| `spotify.load_all_playlists` | Continue loading Spotify pages until all playlists are streamed |
| `spotify.request_page_size` | Spotify playlists requested per API call, up to 50 |
| `spotify.display_batch_size` | Playlist cards emitted per streamed batch |
| `spotify.max_playlist_pages` | Safety limit for Spotify playlist pagination |
| `spotify.song_page_size` | Spotify tracks fetched per request |
| `spotify.max_song_pages` | Safety limit for Spotify track pagination |
| `pagination.default_limit` | Default number of playlists requested per service |
| `pagination.max_limit` | Maximum accepted playlist limit per service |
| `requests.timeout_seconds` | Timeout for Spotify integration requests |

---

## Python Dependencies

This plugin does not declare additional Python dependencies.

---

## API Endpoints

All endpoints require authentication and the `X-Account-Token` header.

### `GET /playlists/{user_id}`

Returns a combined list of local and Spotify playlist summaries.

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | `int` | Optional playlist limit per service |
| `offset` | `int` | Optional playlist offset |
| `services` | `string` | Optional comma-separated services: `local`, `spotify`, or `omniplayr` |

---

### `GET /playlists/{user_id}/stream`

Streams playlist summaries as newline-delimited JSON events.

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | `int` | Optional playlist limit |
| `offset` | `int` | Optional local playlist offset |
| `spotify_offset` | `int` | Optional Spotify-specific offset |
| `services` | `string` | Optional comma-separated services |

Events include `start`, `playlist`, `page`, `error`, and `done`.

---

### `GET /playlists/{user_id}/{playlist_id}`

Returns a single playlist.

Use plain numeric IDs for local playlists. Use `{spotify_playlist_id}:spotify` for Spotify playlists.

---

### `GET /playlists/{user_id}/{playlist_id}/stream`

Streams one playlist and its songs as newline-delimited JSON events.

Events include `start`, `playlist`, `song`, `songs_done`, `error`, and `done`.

---

## Spotify Integration

Spotify support lives in `services/spotify.py` and talks to `spotify@built-in` through OmniPlayr's plugin function system. The playlist plugin does not authenticate with Spotify directly.

The Spotify integration provides:

- Playlist summary conversion into OmniPlayr's playlist shape
- Individual playlist detail loading
- Paginated song streaming
- Background cache refresh for playlist summaries and details

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
