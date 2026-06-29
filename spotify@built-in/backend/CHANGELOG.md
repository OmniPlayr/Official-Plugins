# Changelog

All notable changes to `spotify@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
