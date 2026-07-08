# Changelog

All notable changes to `spotify@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.5] - 2026-07-08

### Changed

- Frontend: Send pause, resume, seek, and volume commands through Spotify's Web API instead of the Web Playback SDK message bridge to avoid SDK-side audio renderer command errors.

## [2.1.4] - 2026-07-08

### Changed

- Frontend: Always transfer Spotify playback to the current OmniPlayr SDK device before starting a track, even when Spotify already appears to be using that device.

## [2.1.3] - 2026-07-08

### Fixed

- Frontend: Hardened Spotify playback state handling so stale SDK events, volume polling failures, and cleanup errors no longer escape as unhandled playback errors.
- Frontend: Report Spotify track endings to OmniPlayr and ignore state updates for tracks that are no longer active.

## [2.1.2] - 2026-07-08

### Fixed

- Frontend: Fixed a bug where the SDK would fail to play a song. 

## [2.1.1] - 2026-07-06

### Changed

- Frontend: Spotify Web Playback SDK generic playback errors now run a device/playback diagnostic pass and report likely causes instead of logging only `Playback error`.
- Frontend: Added transient volume support so pause fades can lower Spotify volume without overwriting the saved player volume.

## [2.1.0] - 2026-07-06

- Backend: Switched imports to the new SDK.

## [2.0.0] - 2026-07-02

### Changed

- Frontend: Switched imports to the new SDK.

## [1.1.7] - 2026-06-29

### Changed

- Bumped backend and frontend package versions for registry publishing.

## [1.1.6] - 2026-06-29

### Changed

- Frontend: Switched the Spotify setup UI to OmniPlayr's shared `PopupContext`.
- Frontend: Removed the setup input focus glow and placeholder color fallback.

## [1.1.3] - 2026-06-29

### Changed
- Frontend: Spotify SDK availability and playback failures now log to the webpage console instead of showing toast notifications.

### Fixed
- Frontend: Added bounded waits around Spotify Web Playback SDK readiness and track state updates so failed playback attempts no longer leave the player stuck loading.

## [1.1.2] - 2026-06-29

### Added
- Added `min-dev-version` field in package.json

## [1.1.1] - 2026-06-22

### Changed
- Moved all of the metadata logic to routes.py

### Added
- Exposed the metadata function to other plugins

## [1.1.0] - 2026-06-22

### Added

- Added playlist collection and individual playlist APIs for built-in plugin integrations.
- Added private and collaborative playlist read permissions.
- Added cached Spotify profile identity for matching playlist owners to OmniPlayr accounts.

### Changed

- Added in-memory access-token caching to reduce database work during playlist pagination.
- Improved playlist pagination diagnostics and request efficiency.

### Fixed

- Spotify playlist rate limits now honor `Retry-After` before retrying.

## [1.0.3] - 2026-06-21

### Changed

- Standardized the changelog format across official plugins.

## [1.0.2] - 2026-05-30

### Fixed

- Frontend: Prevented the login button from appearing twice.

## [1.0.1] - 2026-05-30

### Fixed

- Frontend: Restored the missing login button.

## [1.0.0] - 2026-05-30

### Added

- Added OAuth 2.0 PKCE authentication without a client secret.
- Added automatic token refresh for persistent sessions.
- Added playback through the Spotify Web Playback SDK, registering OmniPlayr as a Spotify device.
- Added server-side metadata from the Spotify Web API, including title, artist, album, artwork, duration, track number, and year.
- Added album artwork as base64 data URIs.
- Added login and logout controls to the plugins menu.
- Added a clear HTTPS requirement warning when the SDK is used in an insecure context.
