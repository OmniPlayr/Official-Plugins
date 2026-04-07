import requests
import time
from dotenv import load_dotenv
import os
import json
from pathlib import Path
from api.helpers.omniplayr import get_plugin_config

load_dotenv()

GENIUS_TOKEN = os.getenv("genius_client_access_token")

PLUGIN_KEY = "artists@built-in"

MUSICBRAINZ_BASE = str(get_plugin_config(PLUGIN_KEY, "api.music_brainz_base_url"))
COVER_ART_BASE = str(get_plugin_config(PLUGIN_KEY, "api.cover_art_base_url"))
GENIUS_BASE = str(get_plugin_config(PLUGIN_KEY, "api.genius_base_url"))

HEADERS_MB = {"User-Agent": str(get_plugin_config(PLUGIN_KEY, "api.request.user_agent"))}
HEADERS_GENIUS = {"Authorization": f"Bearer {GENIUS_TOKEN}"}

_cfg_dir = get_plugin_config(PLUGIN_KEY, "cache.cache_dir", default='/user_storage/artists-cache')
if _cfg_dir:
    CACHE_DIR = Path(_cfg_dir)
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def _get(url, params=None, headers=None, retries=3, **kwargs):
    delay = 1.0
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=headers, **kwargs)
            if r.status_code == 503 and attempt < retries - 1:
                time.sleep(delay)
                delay *= 2
                continue
            r.raise_for_status()
            return r
        except requests.exceptions.HTTPError as e:
            if attempt < retries - 1 and e.response is not None and e.response.status_code == 503:
                time.sleep(delay)
                delay *= 2
                continue
            raise


def cache_path(artist_name):
    safe = artist_name.lower().replace(" ", "_")
    return CACHE_DIR / f"{safe}.json"


def load_cache(artist_name):
    p = cache_path(artist_name)
    if p.exists():
        return json.loads(p.read_text())
    return None


def save_cache(artist_name, data):
    cache_path(artist_name).write_text(json.dumps(data, indent=2))


def _fetch_full_artist_mb(artist_id):
    r = _get(
        f"{MUSICBRAINZ_BASE}/artist/{artist_id}",
        params={"fmt": "json", "inc": "tags"},
        headers=HEADERS_MB,
    )
    return r.json()


def _name_matches(candidate, target):
    return candidate.lower().strip() == target.lower().strip()


def search_artist_mb(artist_name, song_name=None, album_name=None):
    if song_name:
        r = _get(
            f"{MUSICBRAINZ_BASE}/recording/",
            params={
                "query": f'recording:"{song_name}" AND artist:"{artist_name}"',
                "fmt": "json",
                "limit": 5,
            },
            headers=HEADERS_MB,
        )
        for rec in r.json().get("recordings", []):
            for credit in rec.get("artist-credit", []):
                if not isinstance(credit, dict) or "artist" not in credit:
                    continue
                a = credit["artist"]
                if _name_matches(a.get("name", ""), artist_name):
                    return _fetch_full_artist_mb(a["id"]), 0.98

    if album_name:
        r = _get(
            f"{MUSICBRAINZ_BASE}/release/",
            params={
                "query": f'release:"{album_name}" AND artist:"{artist_name}"',
                "fmt": "json",
                "limit": 5,
            },
            headers=HEADERS_MB,
        )
        for rel in r.json().get("releases", []):
            for credit in rel.get("artist-credit", []):
                if not isinstance(credit, dict) or "artist" not in credit:
                    continue
                a = credit["artist"]
                if _name_matches(a.get("name", ""), artist_name):
                    return _fetch_full_artist_mb(a["id"]), 0.95

    r = _get(
        f"{MUSICBRAINZ_BASE}/artist/",
        params={"query": f'artist:"{artist_name}"', "fmt": "json", "limit": 5},
        headers=HEADERS_MB,
    )
    artists = r.json().get("artists", [])
    for a in artists:
        if _name_matches(a.get("name", ""), artist_name):
            return _fetch_full_artist_mb(a["id"]), 0.85
    if artists:
        return _fetch_full_artist_mb(artists[0]["id"]), 0.60
    return None, 0.0


def get_releases_mb(artist_id):
    all_releases = []
    offset = 0
    limit = 100
    while True:
        r = _get(
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
        data = r.json()
        groups = data.get("release-groups", [])
        all_releases.extend(groups)
        if len(groups) < limit:
            break
        offset += limit
    return all_releases


def get_releases_with_covers(releases):
    return [
        {
            "title": r["title"],
            "year": (r.get("first-release-date") or "")[:4] or None,
            "type": r.get("primary-type"),
            "cover_art": f"{COVER_ART_BASE}/{r['id']}/front",
        }
        for r in releases
    ]


def search_artist_genius(artist_name, song_name=None):
    query = f"{artist_name} {song_name}" if song_name else artist_name
    r = _get(
        f"{GENIUS_BASE}/search",
        params={"q": query},
        headers=HEADERS_GENIUS,
    )
    hits = r.json().get("response", {}).get("hits", [])
    for hit in hits:
        result = hit.get("result", {})
        primary = result.get("primary_artist", {})
        if artist_name.lower() in primary.get("name", "").lower():
            return primary
    return None


def get_genius_artist(genius_id):
    r = _get(
        f"{GENIUS_BASE}/artists/{genius_id}",
        headers=HEADERS_GENIUS,
    )
    return r.json().get("response", {}).get("artist", {})


def extract_text(node):
    if isinstance(node, str):
        return node
    if isinstance(node, dict):
        tag = node.get("tag")
        inner = "".join(extract_text(c) for c in node.get("children", []))
        if tag in ("p", "h1", "h2", "h3", "h4", "h5", "h6"):
            return f"\n{inner}\n"
        if tag in ("br",):
            return "\n"
        if tag in ("li",):
            return f"• {inner}\n"
        return inner
    if isinstance(node, list):
        return "".join(extract_text(c) for c in node)
    return ""


def get_artist_info(artist_name, song_name=None, album_name=None, no_cache=False):
    start = time.time()

    if not no_cache:
        cached = load_cache(artist_name)
        if cached:
            cached["from_cache"] = True
            cached["elapsed_ms"] = round((time.time() - start) * 1000)
            return cached

    mb, accuracy = search_artist_mb(artist_name, song_name=song_name, album_name=album_name)
    if not mb:
        return None

    canonical_name = mb["name"]

    genius_hit = search_artist_genius(canonical_name, song_name=song_name)
    genius_artist = get_genius_artist(genius_hit["id"]) if genius_hit else {}

    dom = genius_artist.get("description", {}).get("dom", {})
    bio = extract_text(dom).strip() or None

    releases = get_releases_mb(mb["id"])

    tags = mb.get("tags", [])
    sorted_tags = sorted(tags, key=lambda t: t["count"], reverse=True)
    genres = [t["name"] for t in sorted_tags if t["count"] > 0][:5]

    lifespan = mb.get("life-span", {})

    data = {
        "name": canonical_name,
        "type": mb.get("type"),
        "country": mb.get("country"),
        "disambiguation": mb.get("disambiguation"),
        "active_from": lifespan.get("begin"),
        "active_until": lifespan.get("end") if lifespan.get("ended") else None,
        "genres": genres,
        "bio": bio,
        "genius_url": genius_hit.get("url") if genius_hit else None,
        "genius_image": genius_hit.get("image_url") if genius_hit else None,
        "genius_banner": genius_artist.get("header_image_url") or genius_hit.get("image_url") if genius_hit else None,
        "releases": get_releases_with_covers(releases),
        "from_cache": False,
        "accuracy": accuracy,
        "elapsed_ms": round((time.time() - start) * 1000),
    }

    save_cache(canonical_name, {k: v for k, v in data.items() if k not in ("elapsed_ms", "from_cache")})
    return data