# Changelog

All notable changes to `youtube@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.4] - 2026-07-15

### Fixed

- Fixed YouTube streaming responses by avoiding approximate byte ranges, opening upstream streams before response headers are sent, and surfacing unavailable streams as proper errors.

## [1.0.3] - 2026-07-11

### Fixed

- Switched authenticated YouTube Music playlist listing to `YTMusic.get_library_playlists()` so account playlists no longer fail with HTTP 400 when a YouTube channel ID is rejected by YouTube Music's user playlist endpoint.

## [1.0.2] - 2026-07-11

### Fixed

- Wrote the per-account `ytmusicapi` OAuth JSON file immediately after Google device login succeeds instead of waiting for the first YouTube Music client call or token refresh.

## [1.0.1] - 2026-07-10

### Fixed

- Restored base64-encoded artwork for song and playlist metadata, with backend caching to prevent repeated thumbnail requests and frontend image-host rate limits.

## [1.0.0] - 2026-07-10

### Added

- Added YouTube Music audio streaming through `yt-dlp`.
- Added resilient stream resolution with M4A preference, request deduplication, caching, range support, and automatic refresh of expired stream URLs.
- Added graceful handling for unavailable videos during media-info and stream requests.
- Added metadata lookup through `ytmusicapi`, including public fallback for authenticated lookup failures and thumbnail URLs for artwork.
- Added Google OAuth device login using YouTube Music OAuth credentials.
- Added per-account ytmusicapi OAuth JSON files under configurable storage so refreshed tokens can persist.
- Added YouTube Music playlist listing through `YTMusic.get_user_playlists()`.
- Added playlist detail and song loading through YouTube Data API v3.
- Added playlist video verification that skips unavailable, deleted, private, and unprocessed tracks.
- Added playlist, playlist detail, and playlist song functions for `playlists@built-in`.
- Added backend auth-status reporting so playlist integrations can detect whether YouTube Music is configured and connected.
- Added debug logging for OAuth setup, client creation, playlist requests, and stream resolution.
- Added frontend setup UI for enabling YouTube Data API v3, saving OAuth credentials, approving the device code, and disconnecting.
