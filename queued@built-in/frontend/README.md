# queued@built-in

View and manage the OmniPlayr queue through a dedicated InfoBar. This frontend plugin shows the current song, manually queued songs, and upcoming songs, with drag-and-drop reordering for supported queue sections.

**Version:** Frontend `1.1.0`

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/queued@built-in](https://omniplayr.wokki20.nl/packages/package/queued@built-in)**

---

## What it does

`queued@built-in` adds queue controls directly to the player:

- Add a queue button beside the player controls
- Open the queue in the shared OmniPlayr InfoBar
- Show the currently playing song, priority queue, and next-up queue
- Show a next-track preview in the song information area
- Play any visible queue item immediately
- Reorder manually queued items with drag and drop
- Load long queues incrementally
- Read title, artist, album, and album artwork directly from queue-item metadata
- Keep artwork attached to queue entries so covers can be rendered without a separate lookup
- Open the queue in a popup on mobile through the `queue.mobile:open` event

The plugin is frontend-only. It uses OmniPlayr's player APIs and does not add backend routes.

---

## Requirements

- OmniPlayr development version `2026.11.2` or newer, with the InfoBar API

---

## Playlist integration

When `playlists@built-in` is installed, `queued@built-in` can enrich playlist-backed queues:

- Detect playlist queues from the current queue name or queue item metadata
- Fetch playlist queue metadata from the playlists plugin API
- Display the playlist name in the next-up section title
- Cache playlist queue metadata while the browser session is active

Without `playlists@built-in`, the queue still works with metadata already available on queue items or via the player media endpoint.

---

## Architecture

| Layer | Responsibility |
|-------|----------------|
| **Frontend** | InfoBar rendering, player queue reads, queue reordering, queue metadata and artwork rendering, and playlist metadata enrichment |

### Queue sections

| Section | Description |
|---------|-------------|
| **Now Playing** | The current player item |
| **Queue** | Priority items added manually to play before the next-up list |
| **Next up** | The player next queue, including playlist-backed queues |

### Reordering

Priority queue items and next-up items can be reordered within their own section. The plugin preserves queue order when replacing the player's internal next queue and updates the player so prefetching and UI state stay current.

---

## UI integration

`queued@built-in` integrates with these OmniPlayr frontend extension points:

| Hook or API | Purpose |
|-------------|---------|
| `Player.plugin-target-before-volume-option` | Adds the queue toggle button |
| `Infobar.ib-song-more-info` | Renders the next-track preview in the song information area |
| `registerInfobar` | Registers the queue InfoBar view |
| `queue.mobile:open` | Opens the queue in a mobile popup |

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
