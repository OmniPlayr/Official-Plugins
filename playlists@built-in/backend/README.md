# playlists@built-in

Create, list, and stream playlist data inside OmniPlayr. This plugin manages local OmniPlayr playlists and can also surface Spotify, SoundCloud, and YouTube Music playlists when their source plugins are installed and connected.

**Versions:** Backend `beta-1.5.0` | Frontend `beta-1.5.0`

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
- Integrate with `soundcloud@built-in` to show SoundCloud playlists beside local playlists
- Integrate with `youtube@built-in` to show YouTube Music playlists beside local playlists
- Cache external playlist summaries, details, and song lists on the server to reduce repeated API work
- Refresh stale playlist and song caches in the background instead of blocking the current view
- Start playback from cached or first-arriving tracks while the remaining queue is populated
- Move playlists to the recent-played list only after playback starts, across all supported services
- Respect private playlist visibility so users only see private playlists they own

Local playlists are stored in OmniPlayr's plugin database tables. Spotify, SoundCloud, and YouTube Music playlists are read through their source plugins and cached on disk.

---

## Requirements

- OmniPlayr account authentication
- `spotify@built-in` installed and connected if Spotify playlists should appear
- `soundcloud@built-in` installed and connected if SoundCloud playlists should appear
- `youtube@built-in` installed and connected if YouTube Music playlists should appear
- OmniPlayr development version `2026.8.1` or newer

External playlist support is optional. If Spotify, SoundCloud, or YouTube Music is unavailable, local playlists continue to work.

---

## Configuration

The plugin is configured via `config/settings.toml`. Defaults are supplied by `config_defaults/settings.toml`.

```toml
[cache]
enabled = true
cache_dir = "user_storage/playlist-cache"
refresh_in_background = true
playlist_ttl_seconds = 900
song_ttl_seconds = 300

[streaming]
enabled = true

[providers]
default_services = "local,spotify,soundcloud,youtube"
check_spotify_playlists = true
check_soundcloud_playlists = true
check_youtube_playlists = true

[spotify]
load_all_playlists = true
request_page_size = 50
display_batch_size = 10
display_batch_delay_ms = 0
max_playlist_pages = 100
song_page_size = 50
song_display_batch_size = 20
song_display_batch_delay_ms = 10
song_request_delay_ms = 250
max_song_pages = 100

[soundcloud]
load_all_playlists = true
request_page_size = 50
display_batch_size = 10
display_batch_delay_ms = 0
max_playlist_pages = 100
song_page_size = 50
song_display_batch_size = 20
song_display_batch_delay_ms = 10
song_request_delay_ms = 250
max_song_pages = 100

[youtube]
load_all_playlists = true
request_page_size = 50
display_batch_size = 10
display_batch_delay_ms = 0
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
| `cache.refresh_in_background` | Refresh cached Spotify, SoundCloud, and YouTube Music data in the background |
| `cache.playlist_ttl_seconds` | Seconds before cached playlist collections and details are refreshed |
| `cache.song_ttl_seconds` | Seconds before a cached playlist track list is refreshed in the background |
| `streaming.enabled` | Enable incremental NDJSON playlist responses |
| `providers.default_services` | Comma-separated default services, such as `local,spotify,soundcloud,youtube` |
| `providers.check_spotify_playlists` | Include Spotify when loading playlist collections |
| `providers.check_soundcloud_playlists` | Include SoundCloud when loading playlist collections |
| `providers.check_youtube_playlists` | Include YouTube Music when loading playlist collections |
| `spotify.load_all_playlists` | Continue loading Spotify pages until all playlists are streamed |
| `spotify.request_page_size` | Spotify playlists requested per API call, up to 50 |
| `spotify.display_batch_size` | Playlist cards emitted per streamed batch |
| `spotify.display_batch_delay_ms` | Delay between emitted playlist batches |
| `spotify.max_playlist_pages` | Safety limit for Spotify playlist pagination |
| `spotify.song_page_size` | Spotify tracks requested per provider page |
| `spotify.song_display_batch_size` | Playlist tracks emitted per streamed batch |
| `spotify.song_display_batch_delay_ms` | Delay between emitted track batches |
| `spotify.song_request_delay_ms` | Delay between provider track-page requests |
| `spotify.max_song_pages` | Safety limit for Spotify track pagination |
| `soundcloud.load_all_playlists` | Continue loading SoundCloud pages until all playlists are streamed |
| `soundcloud.request_page_size` | SoundCloud playlists requested per API call, up to 50 |
| `soundcloud.display_batch_size` | SoundCloud playlist cards emitted per streamed batch |
| `soundcloud.display_batch_delay_ms` | Delay between emitted playlist batches |
| `soundcloud.max_playlist_pages` | Safety limit for SoundCloud playlist pagination |
| `soundcloud.song_page_size` | SoundCloud tracks requested per provider page |
| `soundcloud.song_display_batch_size` | Playlist tracks emitted per streamed batch |
| `soundcloud.song_display_batch_delay_ms` | Delay between emitted track batches |
| `soundcloud.song_request_delay_ms` | Delay between provider track-page requests |
| `soundcloud.max_song_pages` | Safety limit for SoundCloud track pagination |
| `youtube.load_all_playlists` | Continue loading YouTube Music pages until all playlists are streamed |
| `youtube.request_page_size` | YouTube Music playlists requested per API call, up to 50 |
| `youtube.display_batch_size` | YouTube Music playlist cards emitted per streamed batch |
| `youtube.display_batch_delay_ms` | Delay between emitted playlist batches |
| `youtube.max_playlist_pages` | Safety limit for YouTube Music playlist pagination |
| `youtube.song_page_size` | YouTube Music tracks requested per provider page |
| `youtube.song_display_batch_size` | Playlist tracks emitted per streamed batch |
| `youtube.song_display_batch_delay_ms` | Delay between emitted track batches |
| `youtube.song_request_delay_ms` | Delay between provider track-page requests |
| `youtube.max_song_pages` | Safety limit for YouTube Music track pagination |
| `pagination.default_limit` | Default number of playlists requested per service |
| `pagination.default_offset` | Default playlist offset when one is not supplied |
| `pagination.max_limit` | Maximum accepted playlist limit per service |
| `requests.timeout_seconds` | Timeout for external provider integration requests |

---

## Python Dependencies

This plugin does not declare additional Python dependencies.

---

## Playback, repeat, and recent playlists

Playlist playback starts when the first playable track is available. The rest of the playlist is streamed into the queue while playback continues, so the frontend does not need to wait for every track before starting.

The player keeps the complete playlist order when playback starts from a track in the middle. Repeat All therefore includes tracks before the selected track and wraps back to the beginning after the final track. Shuffle uses the same complete playlist as its source.

A playlist moves to the top of the recently played list only after playback actually starts. Opening a playlist or viewing its details does not change its position. This behavior applies to local, Spotify, SoundCloud, and YouTube Music playlists.

External playlist summaries and details are cached on the server for 15 minutes, while song lists are cached for 5 minutes. Cached data can be returned immediately and refreshed in the background. Queue entries also retain track metadata, including album artwork, so queue views can render their covers without relying on a separate artwork lookup.

## API Endpoints

All endpoints require authentication and the `X-Account-Token` header.

### `GET /playlists/{user_id}`

Returns a combined list of local, Spotify, SoundCloud, and YouTube Music playlist summaries.

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | `int` | Optional playlist limit per service |
| `offset` | `int` | Optional playlist offset |
| `services` | `string` | Optional comma-separated services: `local`, `spotify`, `soundcloud`, `youtube`, or `omniplayr` |

---

### `GET /playlists/{user_id}/stream`

Streams playlist summaries as newline-delimited JSON events.

| Query param | Type | Description |
|-------------|------|-------------|
| `limit` | `int` | Optional playlist limit |
| `offset` | `int` | Optional local playlist offset |
| `spotify_offset` | `int` | Optional Spotify-specific offset |
| `youtube_offset` | `int` | Optional YouTube-specific offset |
| `services` | `string` | Optional comma-separated services |

Events include `start`, `playlist`, `page`, `error`, and `done`.

---

### `GET /playlists/{user_id}/{playlist_id}`

Returns a single playlist. Cached details are served immediately and refreshed after their cache lifetime.

Use plain numeric IDs for local playlists. Use `{spotify_playlist_id}:spotify` for Spotify playlists, `{soundcloud_playlist_id}:soundcloud` for SoundCloud playlists, and `{youtube_playlist_id}:youtube` for YouTube Music playlists.

---

### `GET /playlists/{user_id}/{playlist_id}/stream`

Streams one playlist and its songs as newline-delimited JSON events. Add `fast=true` to skip the blocking playlist-detail refresh when only the track queue is needed. The frontend uses this fast mode for playback and fills the queue as tracks arrive.

Events include `start`, `playlist`, `song`, `songs_done`, `error`, and `done`.

### `POST /playlists/{user_id}/{playlist_id}/played`

Marks the playlist as recently played. This endpoint accepts local, Spotify, SoundCloud, and YouTube Music playlist IDs.

---

## Provider Integrations

Spotify support lives in `services/spotify.py` and talks to `spotify@built-in` through OmniPlayr's plugin function system. SoundCloud support lives in `services/soundcloud.py` and talks to `soundcloud@built-in` the same way. YouTube Music support lives in `services/youtube.py` and talks to `youtube@built-in`. The playlist plugin does not authenticate with external services directly.

External provider integrations provide:

- Playlist summary conversion into OmniPlayr's playlist shape
- Individual playlist detail loading
- Song streaming from provider playlists
- Background cache refresh for playlist summaries and details

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
