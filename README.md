# Official Plugins

This repository contains the official plugins built and maintained by the OmniPlayr team. Each plugin extends OmniPlayr with new functionality, from playing your local music library to browsing rich artist profiles.

You can find and install every plugin listed here at:
**[https://omniplayr.wokki20.nl/packages/profile/built-in](https://omniplayr.wokki20.nl/packages/profile/built-in)**

---

## What are plugins?

OmniPlayr plugins are self-contained packages that hook into the OmniPlayr server and/or frontend. A plugin can be:

- **Backend only** - adds new API endpoints or audio sources to the server
- **Frontend only** - adds new UI components, pages, or modifications to the player
- **Full-stack** - ships both a backend and a frontend component together

Plugins are declared using a `package.json` manifest and may optionally ship with a `config.toml` for server-side configuration, a `.env` for secrets, and Python dependencies.

---

## Available Plugins

### [`mp3@built-in`](./mp3@built-in/)

**Type:** Backend  
**Version:** 1.2.1

Play your local audio files directly through OmniPlayr. Point the plugin at a folder on your server and it will index and stream everything inside it, no importing or transcoding needed.

Supports `.mp3`, `.flac`, `.wav`, `.ogg`, `.m4a`, `.aac`, and `.opus`. Reads full metadata including embedded album art, track numbers, genres, and more via [Mutagen](https://mutagen.readthedocs.io/).

[Read more →](./mp3@built-in/README.md)

---

### [`spotify@built-in`](./spotify@built-in/)

**Type:** Full-stack (Backend + Frontend)  
**Version:** Backend 1.1.2 / Frontend 1.0.2

Stream Spotify directly inside OmniPlayr. Connect your Spotify account once and OmniPlayr registers itself as a native Spotify playback device. Audio plays through the official Web Playback SDK, metadata is fetched via the Spotify Web API, and tokens are refreshed automatically in the background.

Requires a Spotify Premium account and a Spotify Developer App with a registered redirect URI. Uses PKCE for OAuth so no client secret is ever stored.

[Read more →](./spotify@built-in/backend/README.md)

---

### [`playlists@built-in`](./playlists@built-in/)

**Type:** Full-stack (Backend + Frontend)  
**Version:** Backend beta-0.1.1 / Frontend beta-0.2.1

Create, browse, and stream playlists inside OmniPlayr. The plugin manages local OmniPlayr playlists, automatically creates a private Liked Songs playlist for each user, and includes collaborator metadata for local playlists.

When `spotify@built-in` is installed and connected, Spotify playlists can appear beside local playlists. Playlist collections and individual playlist songs can be streamed incrementally, with disk caching for Spotify summaries, details, and song lists.

[Read more →](./playlists@built-in/backend/README.md)

---

### [`artists@built-in`](./artists@built-in/)

**Type:** Full-stack (Backend + Frontend)
**Version:** Backend 1.2.0 / Frontend 1.2.0

Adds artist and album profile pages to OmniPlayr. Click on any artist or album name in the player and get a full profile: biography, genres, discography, tracklists, cover art, and more.

Data is pulled from [MusicBrainz](https://musicbrainz.org), [Genius](https://genius.com), and the [Cover Art Archive](https://coverartarchive.org). Profiles are cached locally after the first load for instant repeat visits.

[Read more →](./artists@built-in/backend/README.md)

---

### [`tunnels@built-in`](./tunnels@built-in/)

**Type:** Full-stack (Backend + Frontend)

**Version:** Backend 1.0.1 / Frontend 1.0.0

Give an OmniPlayr server a secure public HTTPS address and manage it from the admin UI. The plugin supports both [ngrok](https://ngrok.com) and [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), including setup, start/stop controls, status and public URL reporting, and optional automatic startup.

ngrok uses an account auth token and provides an assigned public address. Cloudflare uses browser authorization, creates the tunnel and DNS route, and lets you choose a subdomain on a Cloudflare-managed domain. The built-in reverse proxy routes frontend, API, WebSocket, and terminal traffic through the same address.

[Read more](./tunnels@built-in/backend/README.md)

---

## Contributing

Have a plugin idea or a fix to submit? PRs are welcome. Make sure each backend or frontend package has a valid `package.json`, configuration defaults for configurable values, and a `README.md` describing what it does. Pull requests and issues use guided templates so version bumps, testing, documentation, and secret handling are not forgotten. Read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [plugin publishing guide](https://omniplayr.wokki20.nl/docs/plugins/publishing.html) for the complete workflow and packaging rules.

### Automatic registry publishing

Every push to `main` that changes a plugin package automatically publishes the affected backend and/or frontend package to the OmniPlayr registry. The workflow stages nested full-stack packages in a folder matching their manifest `id`, as required by the registry, and then runs `omniplayr publish`.

Repository maintainers need to create a GitHub environment named `plugin-registry` and add an encrypted `OMNIPLAYR_ACCESS_TOKEN` secret. Create the token in [registry token settings](https://omniplayr.wokki20.nl/packages/settings/tokens) with only the `packages:write` scope. Plugin versions must be bumped before merging an update. A manual workflow run can publish every tracked plugin package when needed.

If you notice missing or incorrect data in artist or album profiles, the best way to help is to submit corrections directly to [MusicBrainz](https://musicbrainz.org) or [Genius](https://genius.com). Since profiles are sourced directly from those databases, your contributions will show up automatically.

---

## License

MIT. See [LICENSE](./LICENSE) for details.
