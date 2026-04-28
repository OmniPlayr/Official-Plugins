import requests
import time
from dotenv import load_dotenv
import os
import json
from pathlib import Path
from api.helpers.plugins import get_plugin_config
from .artist import (
    _get,
    _name_matches,
    extract_text,
    MUSICBRAINZ_BASE,
    COVER_ART_BASE,
    GENIUS_BASE,
    HEADERS_MB,
    HEADERS_GENIUS,
)

load_dotenv()

PLUGIN_KEY = "artists@built-in"

_cfg_dir = get_plugin_config(PLUGIN_KEY, "cache.cache_dir", default="/user_storage/artists-cache")
CACHE_DIR = Path(_cfg_dir) / "albums"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def cache_path(album_name, artist_name):
    safe = f"{artist_name}_{album_name}".lower().replace(" ", "_")
    return CACHE_DIR / f"{safe}.json"


def load_cache(album_name, artist_name):
    p = cache_path(album_name, artist_name)
    if p.exists():
        return json.loads(p.read_text())
    return None


def save_cache(album_name, artist_name, data):
    cache_path(album_name, artist_name).write_text(json.dumps(data, indent=2))


def search_album_mb(album_name, artist_name, song_name=None, release_type=None):
    if song_name:
        r = _get(
            f"{MUSICBRAINZ_BASE}/recording/",
            params={
                "query": f'recording:"{song_name}" AND release:"{album_name}" AND artist:"{artist_name}"',
                "fmt": "json",
                "limit": 5,
            },
            headers=HEADERS_MB,
        )
        for rec in r.json().get("recordings", []):
            for release in rec.get("releases", []):
                rg = release.get("release-group", {})
                if _name_matches(release.get("title", ""), album_name):
                    return _fetch_full_release_group_mb(rg["id"]), 0.98

    type_order = [release_type.lower()] if release_type else ["album", "ep", "single"]
    for type_filter in type_order:
        r = _get(
            f"{MUSICBRAINZ_BASE}/release-group/",
            params={
                "query": f'releasegroup:"{album_name}" AND artist:"{artist_name}"',
                "fmt": "json",
                "limit": 5,
                "type": type_filter,
            },
            headers=HEADERS_MB,
        )
        groups = r.json().get("release-groups", [])
        for g in groups:
            if _name_matches(g.get("title", ""), album_name):
                return _fetch_full_release_group_mb(g["id"]), 0.90

    r = _get(
        f"{MUSICBRAINZ_BASE}/release-group/",
        params={
            "query": f'releasegroup:"{album_name}" AND artist:"{artist_name}"',
            "fmt": "json",
            "limit": 5,
        },
        headers=HEADERS_MB,
    )
    groups = r.json().get("release-groups", [])
    if groups:
        return _fetch_full_release_group_mb(groups[0]["id"]), 0.65
    return None, 0.0


def _fetch_full_release_group_mb(release_group_id):
    r = _get(
        f"{MUSICBRAINZ_BASE}/release-group/{release_group_id}",
        params={"fmt": "json", "inc": "tags+artists"},
        headers=HEADERS_MB,
    )
    return r.json()


def get_tracklist_mb(release_group_id):
    r = _get(
        f"{MUSICBRAINZ_BASE}/release/",
        params={
            "release-group": release_group_id,
            "fmt": "json",
            "limit": 1,
            "inc": "recordings",
        },
        headers=HEADERS_MB,
    )
    releases = r.json().get("releases", [])
    if not releases:
        return []
    release_id = releases[0]["id"]

    r = _get(
        f"{MUSICBRAINZ_BASE}/release/{release_id}",
        params={"fmt": "json", "inc": "recordings+artist-credits"},
        headers=HEADERS_MB,
    )
    media = r.json().get("media", [])
    tracks = []
    for medium in media:
        for track in medium.get("tracks", []):
            rec = track.get("recording", {})
            length_ms = rec.get("length") or track.get("length")
            artist_credits = rec.get("artist-credit", [])
            artists = [
                c["artist"]["name"]
                for c in artist_credits
                if isinstance(c, dict) and "artist" in c
            ]
            tracks.append({
                "position": track.get("position"),
                "title": track.get("title") or rec.get("title"),
                "recording_id": rec.get("id"),
                "length_ms": length_ms,
                "length_fmt": _fmt_duration(length_ms),
                "artists": artists,
            })
    return tracks


def _fmt_duration(ms):
    if not ms:
        return None
    total_s = ms // 1000
    return f"{total_s // 60}:{total_s % 60:02d}"


def get_cover_art_url(release_group_id):
    try:
        r = requests.get(
            f"{COVER_ART_BASE}/{release_group_id}/front",
            headers=HEADERS_MB,
            allow_redirects=True,
            timeout=5,
        )
        if r.status_code == 200:
            return r.url
    except requests.RequestException:
        pass
    return None


def search_album_genius(album_name, artist_name, song_name=None):
    query = f"{artist_name} {song_name or album_name}"
    r = _get(
        f"{GENIUS_BASE}/search",
        params={"q": query},
        headers=HEADERS_GENIUS,
    )
    hits = r.json().get("response", {}).get("hits", [])
    for hit in hits:
        result = hit.get("result", {})
        album = result.get("album")
        if not album:
            continue
        if (
            artist_name.lower() in result.get("primary_artist", {}).get("name", "").lower()
            and album_name.lower() in album.get("name", "").lower()
        ):
            return album
    return None


def get_genius_album(genius_album_id):
    r = _get(
        f"{GENIUS_BASE}/albums/{genius_album_id}",
        headers=HEADERS_GENIUS,
    )
    return r.json().get("response", {}).get("album", {})


def get_genius_album_tracks(genius_album_id):
    tracks = []
    page = 1
    while True:
        r = _get(
            f"{GENIUS_BASE}/albums/{genius_album_id}/tracks",
            params={"per_page": 50, "page": page},
            headers=HEADERS_GENIUS,
        )
        data = r.json().get("response", {})
        page_tracks = data.get("tracks", [])
        for t in page_tracks:
            song = t.get("song", {})
            tracks.append({
                "position": t.get("number"),
                "title": song.get("title"),
                "genius_id": song.get("id"),
                "genius_url": song.get("url"),
            })
        next_page = data.get("next_page")
        if not next_page:
            break
        page = next_page
    return tracks


def _merge_songs(mb_tracks, cover_art=None):
    merged = []
    for track in mb_tracks:
        merged.append({
            **track,
            "cover_art": cover_art,
        })
    return merged


def get_album_info(album_name, artist_name, song_name=None, release_type=None, no_cache=False):
    start = time.time()

    if not no_cache:
        cached = load_cache(album_name, artist_name)
        if cached:
            cached["from_cache"] = True
            cached["elapsed_ms"] = round((time.time() - start) * 1000)
            return cached

    mb, accuracy = search_album_mb(album_name, artist_name, song_name=song_name, release_type=release_type)
    if not mb:
        return None

    canonical_name = mb.get("title", album_name)

    artist_credits = mb.get("artist-credit", [])
    canonical_artist = next(
        (c["artist"]["name"] for c in artist_credits if isinstance(c, dict) and "artist" in c),
        artist_name,
    )

    tags = mb.get("tags", [])
    sorted_tags = sorted(tags, key=lambda t: t["count"], reverse=True)
    genres = [t["name"] for t in sorted_tags if t["count"] > 0][:5]

    mb_cover_art = get_cover_art_url(mb["id"])

    genius_album_hit = search_album_genius(canonical_name, canonical_artist, song_name=song_name)
    genius_album = get_genius_album(genius_album_hit["id"]) if genius_album_hit else {}

    dom = genius_album.get("description", {}).get("dom", {})
    description = extract_text(dom).strip() or None

    genius_cover = genius_album.get("cover_art_url") or (genius_album_hit.get("cover_art_url") if genius_album_hit else None)
    cover_art = genius_cover or mb_cover_art

    songs = _merge_songs(get_tracklist_mb(mb["id"]), cover_art=cover_art)

    data = {
        "title": canonical_name,
        "artist": canonical_artist,
        "type": mb.get("primary-type"),
        "release_date": mb.get("first-release-date") or None,
        "country": mb.get("country"),
        "disambiguation": mb.get("disambiguation"),
        "genres": genres,
        "description": description,
        "cover_art": cover_art,
        "genius_url": genius_album_hit.get("url") if genius_album_hit else None,
        "songs": songs,
        "from_cache": False,
        "accuracy": accuracy,
        "elapsed_ms": round((time.time() - start) * 1000),
    }

    save_cache(canonical_name, canonical_artist, {k: v for k, v in data.items() if k not in ("elapsed_ms", "from_cache")})
    return data