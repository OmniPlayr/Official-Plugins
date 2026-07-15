# Changelog

All notable changes to `mp3@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.0.1] - 2026-07-15

### Fixed

- Backend: Normalized encoded and account-prefixed local file IDs before path validation so valid local tracks resolve without weakening traversal protection.

## [2.0.0] - 2026-07-06

- Switched imports to the new SDK.

## [1.2.1] - 2026-06-21

### Changed

- Standardized the changelog format across official plugins.

## [1.2.0] - 2026-05-25

### Changed

- Added defaults and type definitions to the plugin configuration.

## [1.1.2] - 2026-04-28

### Fixed

- Corrected the `license` path in `package.json`.

## [1.1.1] - 2026-04-28

### Fixed

- Replaced `x-account-id` authentication with `x-account-token`.

## [1.1.0] - 2026-04-18

### Added

- Added support for multiple accounts.

## [1.0.0]

### Added

- Initial release.
