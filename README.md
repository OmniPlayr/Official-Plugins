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
**Version:** 1.1.0

Play your local audio files directly through OmniPlayr. Point the plugin at a folder on your server and it will index and stream everything inside it, no importing or transcoding needed.

Supports `.mp3`, `.flac`, `.wav`, `.ogg`, `.m4a`, `.aac`, and `.opus`. Reads full metadata including embedded album art, track numbers, genres, and more via [Mutagen](https://mutagen.readthedocs.io/).

[Read more →](./mp3@built-in/README.md)

---

### [`artists@built-in`](./artists@built-in/)

**Type:** Full-stack (Backend + Frontend)  
**Version:** 1.0.0

Adds artist and album profile pages to OmniPlayr. Click on any artist or album name in the player and get a full profile: biography, genres, discography, tracklists, cover art, and more.

Data is pulled from [MusicBrainz](https://musicbrainz.org), [Genius](https://genius.com), and the [Cover Art Archive](https://coverartarchive.org). Profiles are cached locally after the first load for instant repeat visits.

[Read more →](./artists@built-in/backend/README.md)

---

## Contributing

Have a plugin idea or a fix to submit? PRs are welcome. Make sure your plugin follows the existing structure: a `package.json` manifest at the root of the plugin folder, a `config.toml` for any configurable values, and a `README.md` describing what it does.

If you notice missing or incorrect data in artist or album profiles, the best way to help is to submit corrections directly to [MusicBrainz](https://musicbrainz.org) or [Genius](https://genius.com). Since profiles are sourced directly from those databases, your contributions will show up automatically.

---

## License

MIT. See [LICENSE](./LICENSE) for details.