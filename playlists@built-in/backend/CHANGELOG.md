# Changelog

All notable changes to `playlists@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [beta-1.3.1] - 2026-07-08

### Fixed

- Backend: Added YouTube Music to the checked-in live settings file so `youtube` is accepted as a playlist service after install/update.
- Backend: Capped streamed external playlist collection requests to the request `limit` per service instead of continuing through all Spotify, SoundCloud, or YouTube Music pages.
- Backend: Skips YouTube Music cleanly when the source plugin is installed but not connected, instead of emitting a playlist page failure.
- Backend: Added debug logs around YouTube Music auth status and playlist page failures.
- Frontend: Explicitly requests YouTube Music in the Home playlist stream so older user settings cannot omit it from the Home page.

## [beta-1.3.0] - 2026-07-08

### Added

- Backend: Added YouTube Music playlist provider support through `youtube@built-in`.
- Frontend: Added YouTube Music playlist sections and service pages.

## [beta-1.2.0] - 2026-07-08

### Added

- Frontend: Page to view all playlists for a specific service / group. This way it does not show all plugins on the Home page and requires an extra click to see all available playlists to keep the Home page cleaner.

### Changed

- Frontend: Changed the max playlists on the Home page to be 10 by default, if there are more then 10 playlists, the "View all" button will be shown.

## [beta-1.1.2] - 2026-07-08

### Fixed

- Frontend: Start playlist-home playback as soon as the first streamed or cached song arrives instead of waiting for the entire external playlist stream.
- Frontend: Use cached playlist stream songs on the home play button so Spotify playlists can start immediately from backend cache.

## [beta-1.1.1] - 2026-07-08

### Fixed

- Frontend: Stopped persisting playlist home data in `localStorage` and pruned old browser playlist cache entries on startup.
- Backend: Reduced playlist page cache duplication by storing page indexes as playlist IDs while keeping playlist summaries in backend JSON cache files.

## [beta-1.1.0] - 2026-07-06

- Backend: Switched imports to the new SDK.

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
- Added `min-dev-version` field in package.json

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
- Added a dedicated Spotify service module for Spotify playlist conversion, detail loading, and song pagination.
