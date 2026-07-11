# lyrics@built-in

View lyrics for the currently playing OmniPlayr song. This frontend plugin adds a resizable lyrics side tab and a player button so listeners can open synced or plain lyrics without leaving the player.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/lyrics@built-in](https://omniplayr.wokki20.nl/packages/package/lyrics@built-in)**

---

## What it does

When a track is playing, `lyrics@built-in` will:

- Add a lyrics button beside the player controls
- Open lyrics in a resizable dashboard side tab
- Fetch synced lyrics first when enough track metadata is available
- Fall back to search-based lyrics lookup when album or artist metadata is missing
- Display plain lyrics when synced lyrics are not available
- Follow the currently playing synced lyric line as playback progresses
- Let users click or keyboard-select a synced lyric line to seek to that moment
- Cache lyrics per track during the browser session

Lyrics are provided by [LRCLIB](https://lrclib.net/).

---

## Requirements

- OmniPlayr frontend plugin support
- Track metadata with at least a title
- Browser access to `https://lrclib.net/`

The plugin is frontend-only. It does not add backend routes or require server-side configuration.

---

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | Side-tab rendering, lyrics lookup, synced lyric parsing, playback-time following, and shared side-tab state |

### How lyrics lookup works

The plugin reads the current player item and metadata from OmniPlayr. Once the track duration is known, it queries LRCLIB:

1. If title, artist, album, and duration are available, it uses LRCLIB's exact lookup endpoint.
2. If artist or album metadata is missing, it uses LRCLIB search with the metadata that is available.
3. If synced lyrics are returned, timestamped lines are parsed and highlighted during playback.
4. If only plain lyrics are returned, the plugin displays them as regular lyric lines.

If no lyrics are found, the side tab shows a translated not-found message.

---

## UI integration

`lyrics@built-in` mounts into these OmniPlayr frontend hooks:

| Hook | Purpose |
|------|---------|
| `Dashboard.dashboard-hor` | Adds the lyrics side tab |
| `Player.plugin-target-before-volume-option` | Adds the lyrics toggle button |

The side tab shares width and active-tab state with other compatible side-tab plugins, including `queued@built-in`.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
