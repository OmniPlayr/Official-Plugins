# tunnels@built-in

Publish your OmniPlayr server through a secure public tunnel. This backend plugin supports ngrok and Cloudflare Tunnel, manages their setup and lifecycle, and places a reverse proxy in front of the OmniPlayr frontend and backend.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/tunnels@built-in](https://omniplayr.wokki20.nl/packages/package/tunnels@built-in)**

---

## What it does

Once configured, `tunnels@built-in` can:

- Publish OmniPlayr at a secure public HTTPS URL
- Create and manage ngrok and Cloudflare tunnels
- Start and stop tunnels through the OmniPlayr API
- Automatically start selected tunnels when the backend starts
- Proxy frontend, API, WebSocket, and terminal traffic through one public address
- Stream large request and response bodies without buffering them in memory

The plugin runs entirely on the backend. Tunnel setup and lifecycle operations require an OmniPlayr administrator account.

---

## Supported providers

| Provider | Setup | Public address |
|----------|-------|----------------|
| [ngrok](https://ngrok.com) | ngrok auth token | Address assigned by ngrok |
| [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) | Browser authorization and a Cloudflare-managed domain | Chosen subdomain on your domain |

Only one provider is required. You can configure both providers if you want to switch between them.

---

## Setup

### ngrok

1. Create or sign in to your [ngrok account](https://dashboard.ngrok.com).
2. Copy your auth token from the [ngrok dashboard](https://dashboard.ngrok.com/get-started/your-authtoken).
3. Submit the token through the tunnel setup API or add it to a `.env` file next to the plugin:

```env
NGROK_AUTH_TOKEN=your_token_here
```

4. Start the `ngrok` tunnel, optionally enabling automatic startup.

### Cloudflare Tunnel

Cloudflare Tunnel is supported inside the Linux backend container. The plugin downloads the correct `cloudflared` binary for the container architecture when it is first needed.

1. Start Cloudflare authorization with `POST /api/plugin/tunnels/cloudflare/auth`.
2. Open the returned authorization URL and select a domain managed by your Cloudflare account.
3. Poll `GET /api/plugin/tunnels/cloudflare/auth` until `authenticated` is `true`.
4. Configure the tunnel with the subdomain you want to use.
5. Start the tunnel, optionally enabling automatic startup.

The selected domain, tunnel credentials, DNS route, and generated hostname are managed by the plugin.

---

## Configuration

The plugin uses `config/host.toml`, with defaults supplied by `config_defaults/host.toml`:

```toml
[ports]
frontend_port = 8223
backend_port = 8224

[host]
frontend_host = "frontend"
backend_host = "backend"

[proxy]
proxy_port = 9000
```

| Key | Description | Default |
|-----|-------------|---------|
| `ports.frontend_port` | Internal OmniPlayr frontend port | `8223` |
| `ports.backend_port` | Internal OmniPlayr backend port | `8224` |
| `host.frontend_host` | Internal frontend hostname | `frontend` |
| `host.backend_host` | Internal backend hostname | `backend` |
| `proxy.proxy_port` | Port exposed to the tunnel providers | `9000` |

Requests beginning with `/api`, `/ws`, or `/terminal` are sent to the backend. All other requests are sent to the frontend. HTTP and WebSocket connections are supported.

---

## Python dependencies

| Package | Version |
|---------|---------|
| `ngrok` | `>=1.7.0` |
| `aiohttp` | `>=3.14.1` |
| `python-dotenv` | `>=1.0.0` |

---

## API endpoints

All endpoints require administrator authentication.

### `GET /api/plugin/tunnels`

Lists the available tunnel providers and their setup, authentication, running, URL, error, and automatic startup state.

### `PUT /api/plugin/tunnels/{name}/setup`

Saves provider configuration and starts the tunnel.

For ngrok:

```json
{
  "values": {
    "NGROK_AUTH_TOKEN": "your_token_here"
  },
  "auto_start": true
}
```

For Cloudflare Tunnel, complete browser authorization first:

```json
{
  "values": {
    "SUBDOMAIN": "music"
  },
  "auto_start": true
}
```

### `POST /api/plugin/tunnels/{name}/auth`

Starts browser authentication for a provider that supports it. Currently this is used by Cloudflare Tunnel.

### `GET /api/plugin/tunnels/{name}/auth`

Returns the current browser authentication status, authorization URL, selected domain, and any authentication error.

### `PUT /api/plugin/tunnels/{name}/auto-start`

Enables or disables automatic startup for a tunnel.

```json
{
  "enabled": true
}
```

### `POST /api/plugin/tunnels/{name}/start`

Starts a configured tunnel and returns its current state and public URL.

### `POST /api/plugin/tunnels/{name}/stop`

Stops a running tunnel and returns its updated state.

Valid tunnel names are `ngrok` and `cloudflare`.

---

## Security

Starting a tunnel makes your OmniPlayr instance reachable from the internet. Keep authentication enabled, protect administrator credentials, and only share the public URL with people who should have access.

Provider credentials and generated tunnel settings are stored in the plugin directory. Do not commit `.env`, `.cloudflared`, or generated provider settings containing private credentials.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).
