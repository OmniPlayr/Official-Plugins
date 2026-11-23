# lyrics@built-in

View synced or plain lyrics for the currently playing OmniPlayr song. This frontend plugin adds a lyrics InfoBar, a compact preview in the song information area, and a full lyrics page.

**Version:** Frontend `1.2.0`

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/lyrics@built-in](https://omniplayr.wokki20.nl/packages/package/lyrics@built-in)**

---

## What it does

When a track is playing, `lyrics@built-in` will:

- Add a lyrics button beside the player controls
- Open lyrics in the shared OmniPlayr InfoBar
- Show a compact preview in the song information area
- Open the full lyrics view at `/lyrics`
- Adapt the lyrics layout to desktop and mobile player views
- Fetch synced lyrics first when enough track metadata is available
- Fall back to search-based lyrics lookup when album or artist metadata is missing
- Display plain lyrics when synced lyrics are not available
- Follow the currently playing synced lyric line as playback progresses
- Let users click or keyboard-select a synced lyric line to seek to that moment
- Cache lyrics per track during the browser session

Lyrics are provided by [LRCLIB](https://lrclib.net/).

---

## Requirements

- OmniPlayr frontend plugin support with the InfoBar API (development version `2026.11.2` or newer)
- Track metadata with at least a title
- Browser access to `https://lrclib.net/`

The plugin is frontend-only. It does not add backend routes or require server-side configuration. The full lyrics route is registered by the frontend plugin and does not require a separate backend endpoint.

---

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | InfoBar rendering, song-information preview, the `/lyrics` route, lyrics lookup, synced lyric parsing, and playback-time following |

### How lyrics lookup works

The plugin reads the current player item and metadata from OmniPlayr. Once the track duration is known, it queries LRCLIB:

1. If title, artist, album, and duration are available, it uses LRCLIB's exact lookup endpoint.
2. If artist or album metadata is missing, it uses LRCLIB search with the metadata that is available.
3. If synced lyrics are returned, timestamped lines are parsed and highlighted during playback.
4. If only plain lyrics are returned, the plugin displays them as regular lyric lines.

If no lyrics are found, the InfoBar shows a translated not-found message.

---

## UI integration

`lyrics@built-in` integrates with these OmniPlayr frontend extension points:

| Hook or API | Purpose |
|-------------|---------|
| `Player.plugin-target-before-volume-option` | Adds the lyrics toggle button |
| `Infobar.ib-song-more-info` | Renders the compact lyrics preview in the song information area |
| `registerInfobar` | Registers the lyrics InfoBar view |
| `registerRoute` with `/lyrics` | Registers the full lyrics page |

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
