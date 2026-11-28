# Changelog

All notable changes to `playlists@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [beta-1.5.2] - 2026-11-28

### Fixed

- Frontend: Normalized queued track metadata and corrected the playlist browser cache types.

### Changed

- Backend package: Updated the shared release documentation.

## [beta-1.5.1] - 2026-11-23

### Added

- Backend: Added server-side caching for external playlist summaries, details, and song lists, with configurable cache lifetimes.
- Backend: Added a provider-agnostic played endpoint for local, Spotify, SoundCloud, and YouTube Music playlists.

### Changed

- Backend: Reuse the first fetched playlist page when filling the full cache and load provider playlist collections concurrently.
- Backend: Serve cached playlist data immediately and refresh stale entries in the background.
- Frontend: Start playback as soon as the first track is available and populate the remaining queue progressively.
- Frontend: Update recently played ordering only after playback starts, not when a playlist is opened.
- Frontend: Reuse browser-cached playlist lists and avoid unnecessary per-track rerenders while a queue is streaming.

### Fixed

- Backend: Stop forcing fresh Spotify and SoundCloud playlist requests and avoid refreshing cached playlist details on every view.
- Frontend: Preserve the complete playlist order when playback starts in the middle, so Repeat All includes earlier tracks and wraps to the beginning.
- Frontend: Resolve streamed artwork references and attach each playlist track's metadata, including album art, to queue items.

## [beta-1.4.1] - 2026-07-15

### Added

- Backend: Added account-scoped playlist routes that can resolve the current account through `me` and return cached playlist data.
- Frontend: Added translated playlist UI labels and improved playlist queue and device handoff behavior.

### Fixed

- Backend: Reduced account-summary lookup overhead during playlist listing and cache reads.
- Frontend: Scope Home playlist caches to the selected account and refresh them on account switches so password-protected login no longer leaves stale or anonymous Home data.
- Frontend: Render streamed and cached external playlist updates as they arrive and fall back to cached playlists when the stream is slow.
- Frontend: Prime source-plugin activation from Home, playlist, and service playlist controls so Spotify playback starts from the user gesture.

## [beta-1.4.0] - 2026-07-10

### Added

- Backend: Added an ordered playlist queue lookup endpoint so queue views can request only the visible songs in the current playback order.
- Frontend: Playlist queue items now include playlist name and position metadata so queue plugins can label and match playlist-backed songs more reliably.

### Changed

- Frontend: Queue consumers can reuse playlist-backed queue metadata without re-streaming entire playlists when the current queue order is already known locally.

## [beta-1.3.1] - 2026-07-08

### Fixed

- Backend: Added YouTube Music to the live settings file so `youtube` is accepted as a playlist service after install or update.
- Backend: Capped streamed external playlist collection requests to the request limit per service instead of continuing through every provider page.
- Backend: Skip YouTube Music cleanly when the source plugin is installed but not connected, instead of emitting a playlist page failure.
- Backend: Added debug logs around YouTube Music authentication status and playlist page failures.
- Frontend: Explicitly request YouTube Music in the Home playlist stream so older user settings cannot omit it from the Home page.

## [beta-1.3.0] - 2026-07-08

### Added

- Backend: Added YouTube Music playlist provider support through `youtube@built-in`.
- Frontend: Added YouTube Music playlist sections and service pages.

## [beta-1.2.0] - 2026-07-08

### Added

- Frontend: Added a page to view all playlists for a specific service or group, keeping the Home page concise.

### Changed

- Frontend: Set the default maximum number of playlists on the Home page to 10 and show a View all button when there are more.

## [beta-1.1.2] - 2026-07-08

### Fixed

- Frontend: Start playlist-home playback as soon as the first streamed or cached song arrives instead of waiting for the entire external playlist stream.
- Frontend: Use cached playlist stream songs on the Home play button so Spotify playlists can start immediately from backend cache.

## [beta-1.1.1] - 2026-07-08

### Fixed

- Frontend: Stopped persisting playlist Home data in `localStorage` and pruned old browser playlist cache entries on startup.
- Backend: Reduced playlist page cache duplication by storing page indexes as playlist IDs while keeping playlist summaries in backend JSON cache files.

## [beta-1.1.0] - 2026-07-06

### Changed

- Switched imports to the new SDK.

## [beta-1.0.0] - 2026-07-02

### Changed

- Frontend: Switched imports to the new SDK.

## [beta-0.1.2] - 2026-06-29

### Added

- Added SoundCloud playlist provider support through `soundcloud@built-in`.
- Added SoundCloud playlist collection, detail, and song streaming cache support.
- Added SoundCloud provider configuration options.

## [beta-0.1.1] - 2026-06-29

### Added

- Added the `min-dev-version` field to `package.json`.

## [beta-0.1.0] - 2026-06-23

### Added

- Added local OmniPlayr playlist listing.
- Added automatic private **Liked Songs** playlist creation per user.
- Added playlist collaborator metadata for local playlists.
- Added combined local and Spotify playlist collection responses.
- Added incremental NDJSON streaming for playlist collections.
- Added individual playlist lookup for local and Spotify playlists.
- Added incremental song streaming for local and Spotify playlists.
- Added disk caching for Spotify playlist summaries, details, and song lists.
- Added configurable pagination, streaming, cache, and Spotify request settings.
- Added a dedicated Spotify service module for playlist conversion, detail loading, and song pagination.
