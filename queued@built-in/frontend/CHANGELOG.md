# Changelog

All notable changes to `queued@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.2] - 2026-07-15

### Changed

- Added Dutch and English plugin-local translations.
- Improved side-tab transitions, mobile behavior, and queue state updates.
- Added `devices@built-in` to the shared side-tab active state.
- Collapsed the queue side-tab root when the queue is closed.

## [1.0.1] - 2026-07-11

### Changed

- Changed the required min dev version to 2026.7.22.

## [1.0.0] - 2026-07-11

### Added

- Initial frontend release.
- Added a resizable queue side tab and player toggle button.
- Added current, priority, and next-up queue sections.
- Added queue item playback, drag-and-drop reordering, and incremental loading.
- Added playlist-backed queue metadata integration with `playlists@built-in`.
- Added mobile popup support through the `queue.mobile:open` event.
