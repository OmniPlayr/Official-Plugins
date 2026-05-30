# Changelog

All notable changes to `spotify@built-in` will be documented here.

---

## [1.0.2] (frontend) - 2026-05-30

- Fixed a bug where the log in button would double display

## [1.0.1] (frontend) - 2026-05-30

- Fixed a bug where the log in button would not display in the frontend

## [1.0.0] - 2026-05-30

Initial release.

- OAuth 2.0 PKCE flow for secure, secret-free authentication
- Automatic token refresh; sessions stay active without re-authenticating
- Playback via the Spotify Web Playback SDK; OmniPlayr registers as a native Spotify device
- Server-side metadata fetching via the Spotify Web API (title, artist, album, album art, duration, track number, year)
- Album art returned as a base64 data URI for instant display
- Log In / Log Out entry in the OmniPlayr plugins menu
- HTTPS guard with a clear error toast when the SDK cannot be loaded in an insecure context