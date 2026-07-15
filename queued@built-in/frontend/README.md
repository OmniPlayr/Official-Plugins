# queued@built-in

View and manage the OmniPlayr queue from a dedicated side tab. This frontend plugin shows the current song, manually queued songs, and upcoming songs, with drag-and-drop reordering for supported queue sections.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/queued@built-in](https://omniplayr.wokki20.nl/packages/package/queued@built-in)**

---

## What it does

`queued@built-in` adds queue controls directly to the player:

- Add a queue button beside the player controls
- Open the queue in a resizable dashboard side tab
- Show the currently playing song, priority queue, and next-up queue
- Play any visible queue item immediately
- Reorder manually queued items with drag and drop
- Load long queues incrementally
- Resolve richer metadata and artwork for visible queue items
- Open the queue in a popup on mobile through the `queue.mobile:open` event

The plugin is frontend-only. It uses OmniPlayr's player APIs and does not add backend routes.

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
| **Frontend** | Queue side-tab rendering, player queue reads, queue reordering, playlist metadata enrichment, and shared side-tab state |

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

`queued@built-in` mounts into these OmniPlayr frontend hooks:

| Hook | Purpose |
|------|---------|
| `Dashboard.dashboard-hor` | Adds the queue side tab |
| `Player.plugin-target-before-volume-option` | Adds the queue toggle button |

The side tab shares width and active-tab state with other compatible side-tab plugins, including `lyrics@built-in` and `devices@built-in`.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
