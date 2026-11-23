
import json
import re
import threading
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlparse

import requests

from omniplayr.plugins import get_plugin_config

PLUGIN_KEY = "artists@built-in"
_db = None

MUSICBRAINZ_BASE = str(
    get_plugin_config(PLUGIN_KEY, "api.music_brainz_base_url")
).rstrip("/")
COVER_ART_BASE = str(get_plugin_config(PLUGIN_KEY, "api.cover_art_base_url")).rstrip("/")
GENIUS_BASE = str(get_plugin_config(PLUGIN_KEY, "api.genius_base_url")).rstrip("/")

_mb_user_agent = get_plugin_config(
    PLUGIN_KEY,
    "api.request.user_agent",
    default="OmniPlayr/1.0",
)

if not _mb_user_agent or str(_mb_user_agent).strip().lower() in (
    "none",
    "null",
    "undefined",
):
    _mb_user_agent = "OmniPlayr/1.0"

HEADERS_MB = {
    "User-Agent": str(_mb_user_agent).strip(),
    "Accept": "application/json",
}

_cfg_dir = get_plugin_config(
    PLUGIN_KEY,
    "cache.cache_dir",
    default="/user_storage/artists-cache",
)

CACHE_DIR = Path(_cfg_dir or "/user_storage/artists-cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)

_mb_request_lock = threading.Lock()
_mb_last_request = 0.0

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


def set_db(db):
    global _db
    _db = db


def clean_optional(value):
    if value is None:
        return None

    value = str(value).strip()

    if value.lower() in ("", "null", "none", "undefined"):
        return None

    return value


def genius_headers(genius_token):
    return {"Authorization": f"Bearer {genius_token}"}


def _is_musicbrainz_url(url):
    return urlparse(url).netloc == urlparse(MUSICBRAINZ_BASE).netloc


def _musicbrainz_get(url, params=None, headers=None, **kwargs):
    global _mb_last_request

    with _mb_request_lock:
        elapsed = time.monotonic() - _mb_last_request
        remaining = 1.0 - elapsed

        if remaining > 0:
            time.sleep(remaining)

        _mb_last_request = time.monotonic()

        return requests.get(
            url,
            params=params,
            headers=headers,
            **kwargs,
        )


def _retry_delay(response, attempt):
    retry_after = response.headers.get("Retry-After") if response is not None else None

    if retry_after:
        try:
            return max(0.0, float(retry_after))
        except ValueError:
            try:
                retry_date = parsedate_to_datetime(retry_after)

                if retry_date.tzinfo is None:
                    retry_date = retry_date.replace(tzinfo=timezone.utc)

                return max(
                    0.0,
                    (retry_date - datetime.now(timezone.utc)).total_seconds(),
                )
            except (TypeError, ValueError, OverflowError):
                pass

    return min(2 ** attempt, 8)


def _get(url, params=None, headers=None, retries=3, **kwargs):
    attempts = max(1, int(retries))
    kwargs.setdefault("timeout", (5, 20))

    for attempt in range(attempts):
        try:
            if _is_musicbrainz_url(url):
                response = _musicbrainz_get(
                    url,
                    params=params,
                    headers=headers,
                    **kwargs,
                )
            else:
                response = requests.get(
                    url,
                    params=params,
                    headers=headers,
                    **kwargs,
                )

            if response.status_code in RETRYABLE_STATUS_CODES:
                if attempt < attempts - 1:
                    time.sleep(_retry_delay(response, attempt))
                    continue

            response.raise_for_status()
            return response

        except requests.exceptions.RequestException as exc:
            response = getattr(exc, "response", None)
            status_code = response.status_code if response is not None else None

            retryable = (
                status_code in RETRYABLE_STATUS_CODES
                or isinstance(
                    exc,
                    (
                        requests.exceptions.ConnectionError,
                        requests.exceptions.Timeout,
                    ),
                )
            )

            if not retryable or attempt >= attempts - 1:
                raise

            time.sleep(_retry_delay(response, attempt))

    raise requests.exceptions.RequestException("Request failed")


def cache_path(artist_name):
    artist_name = str(artist_name or "")
    safe = re.sub(
        r"[^a-z0-9_-]+",
        "_",
        artist_name.lower(),
    ).strip("_") or "unknown"

    return CACHE_DIR / f"{safe}.json"


def load_cache(artist_name):
    path = cache_path(artist_name)

    if not path.exists():
        return None

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def save_cache(artist_name, data):
    cache_path(artist_name).write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _fetch_full_artist_mb(artist_id):
    response = _get(
        f"{MUSICBRAINZ_BASE}/artist/{artist_id}",
        params={
            "fmt": "json",
            "inc": "tags+aliases",
        },
        headers=HEADERS_MB,
    )

    return response.json()


def _normalize_name(value):
    return re.sub(
        r"[^a-z0-9]+",
        " ",
        str(value or "").lower(),
    ).strip()


def _name_matches(candidate, target):
    return _normalize_name(candidate) == _normalize_name(target)


def _artist_matches(artist, target):
    if not isinstance(artist, dict):
        return False

    names = [
        artist.get("name"),
        artist.get("sort-name"),
        artist.get("disambiguation"),
    ]

    for alias in artist.get("aliases", []) or []:
        if isinstance(alias, dict):
            names.append(alias.get("name"))
            names.append(alias.get("sort-name"))

    return any(
        _name_matches(name, target)
        for name in names
        if name
    )


def _fetch_matching_artist(artist, target):
    if not isinstance(artist, dict) or not artist.get("id"):
        return None

    full = _fetch_full_artist_mb(artist["id"])

    return full if _artist_matches(full, target) else None


def search_artist_mb(artist_name, song_name=None, album_name=None):
    song_name = clean_optional(song_name)
    album_name = clean_optional(album_name)

    if song_name:
        query_parts = [
            f'recording:"{song_name}"',
            f'artist:"{artist_name}"',
        ]

        if album_name:
            query_parts.insert(1, f'release:"{album_name}"')

        response = _get(
            f"{MUSICBRAINZ_BASE}/recording/",
            params={
                "query": " AND ".join(query_parts),
                "fmt": "json",
                "limit": 5,
            },
            headers=HEADERS_MB,
        )

        for recording in response.json().get("recordings", []):
            for credit in recording.get("artist-credit", []):
                if not isinstance(credit, dict) or "artist" not in credit:
                    continue

                artist = credit["artist"]
                full = _fetch_matching_artist(artist, artist_name)

                if full:
                    return full, 0.98

    if album_name:
        response = _get(
            f"{MUSICBRAINZ_BASE}/release/",
            params={
                "query": f'release:"{album_name}" AND artist:"{artist_name}"',
                "fmt": "json",
                "limit": 5,
            },
            headers=HEADERS_MB,
        )

        for release in response.json().get("releases", []):
            for credit in release.get("artist-credit", []):
                if not isinstance(credit, dict) or "artist" not in credit:
                    continue

                artist = credit["artist"]
                full = _fetch_matching_artist(artist, artist_name)

                if full:
                    return full, 0.95

    response = _get(
        f"{MUSICBRAINZ_BASE}/artist/",
        params={
            "query": f'artist:"{artist_name}"',
            "fmt": "json",
            "limit": 5,
        },
        headers=HEADERS_MB,
    )

    artists = response.json().get("artists", [])

    for artist in artists:
        full = _fetch_matching_artist(artist, artist_name)

        if full:
            return full, 0.85

    if artists and artists[0].get("id"):
        return _fetch_full_artist_mb(artists[0]["id"]), 0.60

    return None, 0.0


def get_releases_mb(artist_id):
    all_releases = []
    offset = 0
    limit = 100

    while True:
        response = _get(
            f"{MUSICBRAINZ_BASE}/release-group/",
            params={
                "artist": artist_id,
                "fmt": "json",
                "limit": limit,
                "offset": offset,
                "type": "album|single|ep",
            },
            headers=HEADERS_MB,
        )

        groups = response.json().get("release-groups", [])
        all_releases.extend(groups)

        if len(groups) < limit:
            break

        offset += limit

    return all_releases


def get_releases_with_covers(releases):
    return [
        {
            "title": release["title"],
            "year": (release.get("first-release-date") or "")[:4] or None,
            "type": release.get("primary-type"),
            "cover_art": f"{COVER_ART_BASE}/{release['id']}/front",
        }
        for release in releases
    ]


def search_artist_genius(artist_name, song_name=None, genius_token=None):
    query = f"{artist_name} {song_name}" if song_name else artist_name

    response = _get(
        f"{GENIUS_BASE}/search",
        params={"q": query},
        headers=genius_headers(genius_token),
    )

    hits = response.json().get("response", {}).get("hits", [])

    for hit in hits:
        result = hit.get("result", {})
        primary = result.get("primary_artist", {})

        if artist_name.lower() in primary.get("name", "").lower():
            return primary

    return None


def get_genius_artist(genius_id, genius_token=None):
    response = _get(
        f"{GENIUS_BASE}/artists/{genius_id}",
        headers=genius_headers(genius_token),
    )

    return response.json().get("response", {}).get("artist", {})


def extract_text(node):
    if isinstance(node, str):
        return node

    if isinstance(node, dict):
        tag = node.get("tag")
        inner = "".join(
            extract_text(child)
            for child in node.get("children", [])
        )

        if tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6"):
            return f"\n{inner}\n"

        if tag == "br":
            return "\n"

        if tag == "li":
            return f"• {inner}\n"

        return inner

    if isinstance(node, list):
        return "".join(extract_text(child) for child in node)

    return ""


def get_artist_info(
    artist_name,
    song_name=None,
    album_name=None,
    no_cache=False,
    genius_token=None,
):
    start = time.time()

    song_name = clean_optional(song_name)
    album_name = clean_optional(album_name)

    if not no_cache:
        cached = load_cache(artist_name)

        if cached:
            cached_accuracy = cached.get("accuracy", 1.0)

            if (
                _name_matches(cached.get("name", ""), artist_name)
                or cached_accuracy >= 0.8
            ):
                cached["from_cache"] = True
                cached["elapsed_ms"] = round((time.time() - start) * 1000)
                return cached

    musicbrainz_artist, accuracy = search_artist_mb(
        artist_name,
        song_name=song_name,
        album_name=album_name,
    )

    if not musicbrainz_artist:
        return None

    canonical_name = musicbrainz_artist["name"]

    genius_hit = search_artist_genius(
        canonical_name,
        song_name=song_name,
        genius_token=genius_token,
    )

    genius_artist = (
        get_genius_artist(genius_hit["id"], genius_token=genius_token)
        if genius_hit
        else {}
    )

    description = genius_artist.get("description", {}).get("dom", {})
    bio = extract_text(description).strip() or None

    releases = get_releases_mb(musicbrainz_artist["id"])

    tags = musicbrainz_artist.get("tags", [])
    sorted_tags = sorted(
        tags,
        key=lambda tag: tag.get("count", 0),
        reverse=True,
    )

    genres = [
        tag["name"]
        for tag in sorted_tags
        if tag.get("count", 0) > 0
    ][:5]

    lifespan = musicbrainz_artist.get("life-span", {})

    genius_image = genius_hit.get("image_url") if genius_hit else None
    genius_banner = None

    if genius_hit:
        genius_banner = genius_artist.get("header_image_url") or genius_image

    data = {
        "name": canonical_name,
        "type": musicbrainz_artist.get("type"),
        "country": musicbrainz_artist.get("country"),
        "disambiguation": musicbrainz_artist.get("disambiguation"),
        "active_from": lifespan.get("begin"),
        "active_until": (
            lifespan.get("end")
            if lifespan.get("ended")
            else None
        ),
        "genres": genres,
        "bio": bio,
        "genius_url": genius_hit.get("url") if genius_hit else None,
        "genius_image": genius_image,
        "genius_banner": genius_banner,
        "releases": get_releases_with_covers(releases),
        "from_cache": False,
        "accuracy": accuracy,
        "elapsed_ms": round((time.time() - start) * 1000),
    }

    save_cache(
        canonical_name,
        {
            key: value
            for key, value in data.items()
            if key not in ("elapsed_ms", "from_cache")
        },
    )

    return data
