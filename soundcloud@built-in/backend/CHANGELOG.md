# Changelog

All notable changes to `soundcloud@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-07-02

### Changed

- Frontend: Switched imports to the new SDK.

## [1.0.4] - 2026-06-29

### Changed

- Bumped backend and frontend package versions for registry publishing.

## [1.0.3] - 2026-06-29

### Changed

- Bumped the backend and frontend packages after the `1.0.2` release.

## [1.0.2] - 2026-06-29

### Changed

- Frontend: Removed the setup input focus glow and placeholder color fallback.

## [1.0.1] - 2026-06-29

### Added

- Added basic public SoundCloud URL playback support without SoundCloud app credentials.
- Added public SoundCloud oEmbed metadata resolution and `api.oembed_base_url` config.

### Changed

- Switched the SoundCloud setup UI to OmniPlayr's shared `PopupContext`.
- Changed the plugins menu action from **Log In** to **Connect Account**.
- Documented SoundCloud's current Artist Pro app-registration requirement and updated the app setup link to `https://soundcloud.com/you/apps`.

## [1.0.0] - 2026-06-29

### Added

- Added backend configuration for SoundCloud API URLs, request timeout, playlist cache TTL, and OAuth state TTL.
- Added SoundCloud OAuth setup with PKCE, Client ID, and Client Secret storage.
- Added token refresh and authenticated SoundCloud API requests.
- Added SoundCloud track metadata lookup.
- Added frontend playback through the SoundCloud HTML5 Widget API.
- Added plugins menu login and logout actions.
- Added cross-plugin playlist functions for `playlists@built-in`.
