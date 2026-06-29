# Changelog

All notable changes to `artists@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-06-29

### Added

- Added account-scoped Genius token storage and setup endpoints.
- Added a frontend plugin menu item that opens a PopupContext token setup dialog.
- Added an admin-only option to save the Genius token for all accounts.
- Added a no-token state for artist and album pages when the current account has not configured a token.
- Moved artists plugin frontend text into plugin-local i18n resources.
- Added `min-dev-version` field in package.json

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
