# Changelog

All notable changes to `lyrics@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.3.1] - 2026-11-28

### Changed

- Restored the microphone icon, kept the shortcut available while idle, and opened the mobile InfoBar as a full-height lyrics view.

## [1.3.0] - 2026-11-28

### Changed

- Moved the lyrics control to Track actions and kept the desktop player shortcut.

## [1.2.0] - 2026-11-22

### Added

- Added an InfoBar preview in the song information area.
- Added the full lyrics page at `/lyrics`.
- Added lyrics rendering for the desktop and mobile player layouts.

### Changed

- Replaced the legacy dashboard side-tab integration with OmniPlayr's shared InfoBar API.
- Updated the player lyrics control to open and track the active lyrics InfoBar.
- Improved the lyrics view with artwork-derived colors and responsive synced-lyric following.

## [1.0.3] - 2026-07-15

### Changed

- Added Dutch and English plugin-local translations.
- Improved side-tab transitions and loading states.
- Added `devices@built-in` to the shared side-tab active state.
- Collapsed the lyrics side-tab root when lyrics are closed.

## [1.0.1] - 2026-07-11

### Fixed

- Fixed the mobile lyrics layout so it appears below the fullscreen player.

## [1.0.0] - 2026-07-11

### Added

- Initial frontend release.
- Added a resizable lyrics side tab and player toggle button.
- Added synced and plain lyrics lookup through LRCLIB.
- Added synced lyric highlighting, auto-follow scrolling, and lyric-line seeking.
- Added browser-session lyrics caching and translated loading and not-found states.
