# Changelog

All notable changes to `devices@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.2.0] - 2026-11-28

### Changed

- Frontend: Replaced the device side tab and popup with the shared InfoBar, including a partial sheet on mobile.

## [1.1.0] - 2026-11-28

### Changed

- Frontend: Moved the device picker to Track actions and kept its desktop shortcut.

## [1.0.0] - 2026-07-13

### Added

- Added account device registration, heartbeat refresh, disconnect, and duplicate cleanup.
- Added remote command routes for OmniPlayr device switching.
- Added frontend device list, current-device display, configurable refetching, and loading state.
- Added mobile popup entry point and shared side-tab behavior.
- Added English and Dutch frontend translations.
- Added Google Cast output discovery and playback for streamable sources.
- Added browser-session device identifiers so refreshes reuse the same device entry while separate tabs remain distinct.
- Added synced volume support for remote OmniPlayr devices.
- Added neutral current-device and hover styling, with primary-color text highlighting only for the device that is currently handling playback.
- Tightened playback-device highlighting so primary text follows the exact active playback device instead of partial label matches.
