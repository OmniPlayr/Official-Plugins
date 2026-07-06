# Changelog

All notable changes to `tunnels@built-in` are documented here. This changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [2.1.0] - 2026-07-06

- Backend: Switched imports to the new SDK.

## [2.0.0] - 2026-07-02

### Changed

- Frontend: Switched imports to the new SDK.

## [1.0.1] - 2026-06-21

### Changed

- Standardized the changelog format across official plugins.

## [1.0.0] - 2026-06-21

### Added

- Added secure public access through ngrok and Cloudflare Tunnel.
- Added ngrok setup using an account auth token.
- Added Cloudflare browser authorization and managed-domain selection.
- Added automatic Cloudflare tunnel creation and DNS routing for a chosen subdomain.
- Added automatic `cloudflared` downloads for supported Linux container architectures.
- Added setup, authentication status, start, stop, and automatic startup API endpoints.
- Added persistent automatic startup preferences for each tunnel provider.
- Added a reverse proxy for frontend, API, WebSocket, and terminal traffic.
- Added streaming for large HTTP request and response bodies.
- Added runtime tunnel status, public URL, and error reporting.
- Added administrator authentication to all tunnel management endpoints.
