# Changelog

All notable changes to `playlists@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
