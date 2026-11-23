# Changelog

All notable changes to `artists@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.3] - 2026-11-23

### Changed

- Backend: Rate-limited MusicBrainz requests to one request per second.

### Fixed

- Backend: Added retries for transient MusicBrainz rate-limit, server, connection, and timeout failures, respecting `Retry-After` when provided.
- Backend: The artist existence endpoint now distinguishes temporary MusicBrainz outages from confirmed missing results by returning an `unknown` status and marking the result as retryable.

## [2.1.2] - 2026-07-13

### Fixed

- Backend: Hardened artist and album path handling and cache fallbacks so profile routes handle special characters and missing cached data more reliably.
- Frontend: Improved artist and album route handling and plugin navigation integration.

## [2.1.1] - 2026-07-08

### Added

- Frontend: When a song has multiple artists and the artist string contains `&`, split and display the artists separately.

## [2.1.0] - 2026-07-06

### Changed

- Backend and frontend: Switched imports to the new SDK.

## [2.0.0] - 2026-07-02

### Changed

- Frontend: Switched text rendering to plugin translations.

## [1.2.0] - 2026-06-29

### Added

- Added account-scoped Genius token storage and setup endpoints.
- Added a frontend plugin menu item that opens a PopupContext token setup dialog.
- Added an admin-only option to save the Genius token for all accounts.
- Added a no-token state for artist and album pages when the current account has not configured a token.
- Moved artists plugin frontend text into plugin-local i18n resources.
- Added the `min-dev-version` field to `package.json`.

### Changed

- Genius requests now use the current account's saved token instead of a server-wide `.env` token.

## [1.1.3] - 2026-06-23

### Added

- Added `GET /api/plugin/artists/exists` for lightweight artist existence checks with optional album and song matching.

## [1.1.2] - 2026-06-22

### Fixed

- Moved the artist and album cache to the root-mounted `/user_storage/artists-cache` directory.

## [1.1.1] - 2026-06-21

### Changed

- Standardized the changelog format across official plugins.

## [1.1.0] - 2026-05-23

### Changed

- Added defaults and type definitions to the plugin configuration.

## [1.0.1] - 2026-04-28

### Fixed

- Replaced `x-account-id` authentication with `x-account-token`.

## [1.0.0]

### Added

- Initial release.
