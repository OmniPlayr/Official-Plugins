# artists@built-in

Adds full artist and album profile pages to OmniPlayr. Click any artist or album name in the player and instantly get a rich profile pulled from MusicBrainz, Genius, and the Cover Art Archive: biography, genres, discography, tracklists, cover art, and more.

You can find this plugin at:
**[https://omniplayr.wokki20.nl/packages/package/artists@built-in](https://omniplayr.wokki20.nl/packages/package/artists@built-in)**

---

## What it does

### In the player

Artist and album names in the player become clickable. Hovering over a name pre-fetches the profile in the background so it opens instantly when you click. Clicking navigates you to a dedicated profile page.

### Artist pages (`/artist/:artist`)

- Profile image and banner from Genius
- Country of origin with flag
- Active years
- Genres (from MusicBrainz community tags)
- Full biography from Genius
- Complete discography grouped by Albums, EPs, and Singles, each with cover art and release year, sorted newest first
- Clicking any release opens the album page

### Album pages (`/artist/:artist/:album`)

- Cover art (from Genius or Cover Art Archive, whichever has the best image)
- Release date, track count, and release type
- Genres
- Full tracklist with track numbers, titles, featured artists, and durations

Profiles are cached in memory after the first load, so they open instantly on repeat visits within the same session.

---

## Data sources

| Source | Used for |
|--------|----------|
| [MusicBrainz](https://musicbrainz.org) | Artist metadata, active years, country, genres, discography, tracklists |
| [Genius](https://genius.com) | Artist biography, profile image, banner image, album descriptions, album art |
| [Cover Art Archive](https://coverartarchive.org) | Album and release artwork (fallback when Genius art is unavailable) |

If you notice missing or incorrect information, submitting corrections to those databases will make them show up here automatically. No update to this plugin is needed.

---

## Requirements

### Genius API token

This plugin requires a Genius Client Access Token to fetch artist bios and images.

1. Create an account at [genius.com](https://genius.com)
2. Go to [genius.com/api-clients](https://genius.com/api-clients) and create a new API client
3. Copy your **Client Access Token**
4. Create a `.env` file next to the plugin (see `.env.example`) and add:

```env
genius_client_access_token="your_token_here"
```

---

## Configuration

The plugin is configured via `config.toml`:

```toml
[api]
music_brainz_base_url = "https://musicbrainz.org/ws/2"
cover_art_base_url = "https://coverartarchive.org/release-group"
genius_base_url = "https://api.genius.com"

[api.request]
user_agent = "OmniPlayr-ArtistLookup/0.0.1"

[cache]
cache_dir = "user_storage/artists-cache"
```

| Key | Description |
|-----|-------------|
| `api.music_brainz_base_url` | MusicBrainz API base URL |
| `api.cover_art_base_url` | Cover Art Archive base URL |
| `api.genius_base_url` | Genius API base URL |
| `api.request.user_agent` | User-Agent header sent with MusicBrainz requests (required by their API policy) |
| `cache.cache_dir` | Where to store cached artist and album JSON responses on disk |

---

## Python Dependencies

| Package | Version |
|---------|---------|
| `requests` | `>=2.33.1` |
| `python-dotenv` | `>=1.2.2` |

---

## API Endpoints

Both endpoints require authentication.

### `GET /plugin/artist/{artist}`

Fetches a full artist profile.

| Query param | Type | Description |
|-------------|------|-------------|
| `song` | `string` | Optional - a known song by the artist, used to improve search accuracy |
| `album` | `string` | Optional - a known album by the artist, used to improve search accuracy |
| `no_cache` | `bool` | Skip the disk cache and fetch fresh data |

**Response fields:** `name`, `type`, `country`, `disambiguation`, `active_from`, `active_until`, `genres`, `bio`, `genius_url`, `genius_image`, `genius_banner`, `releases`, `accuracy`, `elapsed_ms`, `from_cache`

---

### `GET /plugin/album/{album}`

Fetches a full album profile.

| Query param | Type | Description |
|-------------|------|-------------|
| `artist` | `string` | **Required** - the artist name |
| `song` | `string` | Optional - a known song on the album, improves accuracy |
| `type` | `string` | Optional - release type hint (`album`, `ep`, `single`) |
| `no_cache` | `bool` | Skip the disk cache and fetch fresh data |

**Response fields:** `title`, `artist`, `type`, `release_date`, `country`, `disambiguation`, `genres`, `description`, `cover_art`, `genius_url`, `songs`, `accuracy`, `elapsed_ms`, `from_cache`

---

## Accuracy

Each response includes an `accuracy` field (a float between 0 and 1) representing how confident the plugin is that it returned the right result. Higher values mean the match was found by a more specific search method:

| Value | How it was matched |
|-------|--------------------|
| `0.98` | Matched via a specific song title |
| `0.95` | Matched via a specific album title |
| `0.90` | Matched by release type filter |
| `0.85` | Exact name match in artist search |
| `0.65` | Fuzzy release group match |
| `0.60` | First result fallback |

---

## Caching

Profiles are cached on two levels:

- **Disk cache** - JSON files stored in `cache_dir` persist between server restarts. Artist and album files are stored separately and named after the artist/album.
- **In-memory cache** - the frontend caches responses in a `Map` for the duration of the session, so navigating back to a profile is instant.

To force a fresh fetch, add `?no_cache=true` to the API request or refresh the page while holding a reload.