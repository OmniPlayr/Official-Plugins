# mp3@built-in

Play your local audio files with OmniPlayr. This plugin registers itself as an audio source and streams files directly from a folder on your server, no importing, no transcoding, no cloud required.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/mp3@built-in](https://omniplayr.wokki20.nl/packages/package/mp3@built-in)**

---

## What it does

Once installed and pointed at a music folder, `mp3@built-in` will:

- Let OmniPlayr discover and list all supported audio files in that folder (including subfolders)
- Stream audio to the player on demand using efficient chunked streaming
- Extract and serve full metadata from each file: title, artist, album, album artist, track number, year, genre, duration, and embedded album art

Everything runs locally on your server. No internet connection is needed.

---

## Supported formats

| Format | Extension |
|--------|-----------|
| MP3 | `.mp3` |
| FLAC | `.flac` |
| WAV | `.wav` |
| Ogg Vorbis | `.ogg` |
| Opus | `.opus` |
| AAC / M4A | `.m4a`, `.aac` |

---

## Configuration

The plugin is configured via `config.toml`:

```toml
[storage]
mp3_music_dir = "/user_storage/music"

[streaming]
default_chunk_size = 65_536
```

| Key | Description | Default |
|-----|-------------|---------|
| `storage.mp3_music_dir` | Absolute path to your music folder on the server | `/user_storage/music` |
| `streaming.default_chunk_size` | How many bytes to send per chunk when streaming | `65536` (64 KB) |

---

## Python Dependencies

| Package | Version |
|---------|---------|
| `mutagen` | `>=1.47` |
| `Pillow` | `>=10.0` |

Mutagen handles all metadata extraction. Pillow is included for any image processing that may be needed for album art.

---

## API Endpoints

### `GET /mp3/browse`

Returns a list of all audio files found recursively inside the configured music directory.

**Response:**
```json
{
    "files": [
        "Artist/Album/01 - Track.mp3",
        "Artist/Album/02 - Track.flac"
    ]
}
```

This endpoint requires authentication.

---

## Metadata extraction

Metadata is read using [Mutagen](https://mutagen.readthedocs.io/) at request time. Each format uses its own tag standard:

- **MP3** - ID3 tags (`TIT2`, `TPE1`, `TALB`, `TRCK`, etc.)
- **FLAC** - Vorbis comment fields (`title`, `artist`, `album`, etc.)
- **M4A / AAC** - iTunes atoms (`©nam`, `©ART`, `©alb`, etc.)
- **OGG / Opus** - Vorbis comment fields
- **WAV** - ID3 tags embedded in the WAV container

Embedded album art is extracted and returned as a base64-encoded data URI so the player can display it immediately without a separate request.

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md).