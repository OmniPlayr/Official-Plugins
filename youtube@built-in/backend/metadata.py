import base64
import re
import time
from collections import OrderedDict
from threading import RLock

import requests
from ytmusicapi import YTMusic

_METADATA_CACHE_TTL = 3600
_METADATA_CACHE_MAX_ENTRIES = 512
_ARTWORK_CACHE_TTL = 21600
_ARTWORK_ERROR_CACHE_TTL = 300
_ARTWORK_CACHE_MAX_ENTRIES = 512
_SONG_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
_metadata_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_metadata_cache_lock = RLock()
_artwork_cache: OrderedDict[str, tuple[float, str | None]] = OrderedDict()
_artwork_cache_lock = RLock()
_public_client = YTMusic()
_http = requests.Session()


def _empty_metadata() -> dict:
    return {
        "duration": None,
        "title": None,
        "artist": None,
        "album": None,
        "album_artist": None,
        "year": None,
        "track": None,
        "genre": None,
        "album_art": None,
        "other": None,
    }


def get_artwork(url: str | None) -> str | None:
    if not url:
        return None

    with _artwork_cache_lock:
        cached = _artwork_cache.get(url)
        if cached:
            ttl = _ARTWORK_CACHE_TTL if cached[1] else _ARTWORK_ERROR_CACHE_TTL
            if time.monotonic() - cached[0] < ttl:
                _artwork_cache.move_to_end(url)
                return cached[1]
            _artwork_cache.pop(url, None)

    artwork = None
    try:
        response = _http.get(url, timeout=(5, 15))
        response.raise_for_status()
        content_type = response.headers.get("content-type", "image/jpeg").split(";", 1)[0].strip()
        if not content_type.startswith("image/"):
            content_type = "image/jpeg"
        artwork = f"data:{content_type};base64," + base64.b64encode(response.content).decode("ascii")
    except requests.RequestException:
        pass

    with _artwork_cache_lock:
        _artwork_cache[url] = (time.monotonic(), artwork)
        _artwork_cache.move_to_end(url)
        while len(_artwork_cache) > _ARTWORK_CACHE_MAX_ENTRIES:
            _artwork_cache.popitem(last=False)
    return artwork


def get_metadata(song_id: str) -> dict:
    if not _SONG_ID_PATTERN.fullmatch(str(song_id or "")):
        return _empty_metadata()

    with _metadata_cache_lock:
        cached = _metadata_cache.get(song_id)
        if cached and time.monotonic() - cached[0] < _METADATA_CACHE_TTL:
            _metadata_cache.move_to_end(song_id)
            return cached[1].copy()

    base = _empty_metadata()
    try:
        track_info = _public_client.get_song(song_id)
    except Exception:
        return base

    if isinstance(track_info, dict):
        video_details = track_info.get("videoDetails") or {}
        thumbnails = video_details.get("thumbnail", {}).get("thumbnails", [])
        base["duration"] = int(video_details["lengthSeconds"]) if video_details.get("lengthSeconds") else None
        base["title"] = video_details.get("title")
        base["artist"] = video_details.get("author")
        base["album_art"] = get_artwork(thumbnails[-1].get("url") if thumbnails else None)
        base["other"] = track_info

    with _metadata_cache_lock:
        _metadata_cache[song_id] = (time.monotonic(), base.copy())
        _metadata_cache.move_to_end(song_id)
        while len(_metadata_cache) > _METADATA_CACHE_MAX_ENTRIES:
            _metadata_cache.popitem(last=False)
    return base
