# spotify@built-in

Stream Spotify directly inside OmniPlayr. This plugin connects your Spotify account using OAuth and plays audio through the official Spotify Web Playback SDK. No file downloads, no transcoding, no third-party proxies.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/spotify@built-in](https://omniplayr.wokki20.nl/packages/package/spotify@built-in)**

---

## What it does

Once connected to your Spotify account, `spotify@built-in` will:

- Register OmniPlayr as a Spotify playback device using the Web Playback SDK
- Let you play any Spotify track directly in the OmniPlayr player
- Pull full track metadata from the Spotify API: title, artist, album, album art, duration, track number, and release year
- Handle OAuth token refresh automatically so your session stays alive without re-authenticating
- Add a **Log In / Log Out** entry to the plugins menu for quick account management

Everything runs through Spotify's official APIs. A **Spotify Premium** account is required for Web Playback SDK access.

---

## Requirements

- A **Spotify Premium** account
- A **Spotify Developer App** with a registered redirect URI (see [Setup](#setup) below)
- OmniPlayr served over **HTTPS** in production (the Spotify Web Playback SDK requires a secure context; `localhost` over HTTP is allowed for development)

---

## Setup

Before connecting, you need to create a Spotify Developer App and register a redirect URI:

1. Go to [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create a new app.
2. In the app settings, add the following URI to **Redirect URIs**:
   ```
   https://<your-omniplayr-host>/api/plugin/spotify/callback
   ```
3. Copy your **Client ID**.
4. In OmniPlayr, open the plugins menu and click **Log In** under the Spotify plugin.
5. Enter your Client ID and complete the authorization flow.

The plugin uses PKCE for the OAuth flow, so no client secret is ever stored or sent.

---

## Python Dependencies

| Package | Version |
|---------|---------|
| `requests` | `>=2.28` |

Used for all server-side communication with the Spotify API, including token exchange and metadata fetching.

---

## Architecture

This plugin is **full-stack**: it ships both a backend and a frontend component.

| Layer | Responsibility |
|-------|---------------|
| **Backend** | OAuth PKCE flow, token storage, token refresh, metadata fetching via the Spotify Web API |
| **Frontend** | Spotify Web Playback SDK loading, OmniPlayr source plugin integration, setup UI |

### How playback works

Audio is handled entirely in the browser by the [Spotify Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk). The backend is not involved in streaming. When a track is played:

1. The frontend requests a valid access token from the backend (`GET /spotify/token`).
2. The SDK authenticates with Spotify using that token and registers OmniPlayr as an active device.
3. The SDK plays the track directly from Spotify's CDN.

### How metadata works

Metadata is fetched server-side via the Spotify Web API (`GET /v1/tracks/:id`). Album art is fetched from Spotify's image CDN and returned as a base64-encoded data URI so the player can display it without a separate request.

---

## API Endpoints

### `POST /spotify/setup`

Saves your Spotify Client ID for the current account. Call this before starting the OAuth flow.

**Body:**
```json
{ "client_id": "your_client_id_here" }
```

This endpoint requires authentication.

---

### `GET /spotify/status`

Returns the current connection state for the authenticated account.

**Response:**
```json
{
    "connected": true,
    "client_id_set": true,
    "client_id": "your_client_id_here"
}
```

This endpoint requires authentication.

---

### `GET /spotify/auth/start`

Initiates the PKCE OAuth flow. Returns a Spotify authorization URL to redirect the user to.

**Response:**
```json
{ "url": "https://accounts.spotify.com/authorize?..." }
```

This endpoint requires authentication.

---

### `GET /spotify/callback`

OAuth redirect target. Exchanges the authorization code for tokens and stores them. Redirects back to the OmniPlayr frontend on success.

This endpoint is public (called by Spotify's redirect, not by the client directly).

---

### `GET /spotify/token`

Returns a valid access token for the current account, refreshing it automatically if it has expired.

**Response:**
```json
{ "access_token": "BQA..." }
```

Returns `401` if the account is not connected. This endpoint requires authentication.

---

### `DELETE /spotify/disconnect`

Revokes the stored tokens for the current account without removing the Client ID configuration.

**Response:**
```json
{ "ok": true }
```

This endpoint requires authentication.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).