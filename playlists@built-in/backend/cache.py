import json
import time
from pathlib import Path
from threading import RLock, Thread
from omniplayr.plugins import log

from .config import config

_cache_lock = RLock()
_refreshing = set()


def cache_dir() -> Path:
    configured = Path(str(config("cache.cache_dir", "user_storage/playlist-cache")))
    if configured.is_absolute():
        path = configured
    elif configured.parts and configured.parts[0] == "user_storage" and Path("/user_storage").exists():
        path = Path("/") / configured
    elif Path.cwd().name == "backend":
        path = Path.cwd().parent / configured
    else:
        path = Path.cwd() / configured
    path.mkdir(parents=True, exist_ok=True)
    return path


def safe_cache_part(value) -> str:
    return "".join(character for character in str(value) if character.isalnum() or character in "-_") or "unknown"


def cache_path(user_id: int, service: str, playlist_id, detail: bool = False) -> Path:
    suffix = "detail-v2" if detail else "summary"
    return cache_dir() / safe_cache_part(user_id) / service / f"{safe_cache_part(playlist_id)}.{suffix}.json"


def page_path(user_id: int, service: str, limit: int, offset: int) -> Path:
    return cache_dir() / safe_cache_part(user_id) / service / f"page-{offset}-{limit}.json"


def full_path(user_id: int, service: str) -> Path:
    return cache_dir() / safe_cache_part(user_id) / service / "full.json"


def song_cache_path(user_id: int, service: str, playlist_id) -> Path:
    return cache_dir() / safe_cache_part(user_id) / service / f"{safe_cache_part(playlist_id)}.songs-v1.json"


def read_json(path: Path, cache_enabled=None):
    if cache_enabled is None:
        cache_enabled = bool(config("cache.enabled", True))
    if not cache_enabled or not path.exists():
        return None
    try:
        with _cache_lock:
            return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(path: Path, value, cache_enabled=None) -> None:
    if cache_enabled is None:
        cache_enabled = bool(config("cache.enabled", True))
    if not cache_enabled:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with _cache_lock:
        temporary.write_text(json.dumps(value, ensure_ascii=False, default=str), encoding="utf-8")
        temporary.replace(path)


def read_detail(user_id: int, service: str, playlist_id):
    return read_json(cache_path(user_id, service, playlist_id, detail=True))


def write_detail(user_id: int, service: str, playlist_id, playlist) -> None:
    write_json(cache_path(user_id, service, playlist_id, detail=True), playlist)


def read_song_cache(user_id: int, service: str, playlist_id):
    cached = read_json(song_cache_path(user_id, service, playlist_id))
    if not isinstance(cached, dict) or not cached.get("complete") or not isinstance(cached.get("songs"), list):
        return None
    for song in cached["songs"]:
        metadata = song.get("metadata") if isinstance(song, dict) else None
        if not isinstance(metadata, dict):
            return None
        if isinstance(song.get("added_by_picture"), dict) or isinstance(metadata.get("album_art"), dict):
            return None
    return cached


def write_song_cache(user_id: int, service: str, playlist_id, songs: list[dict], complete: bool) -> None:
    write_json(
        song_cache_path(user_id, service, playlist_id),
        {
            "version": 1,
            "cached_at": time.time(),
            "complete": complete,
            "songs": songs,
        },
    )


def read_cached_page(user_id: int, service: str, limit: int, offset: int):
    cache_enabled = bool(config("cache.enabled", True))
    index = read_json(page_path(user_id, service, limit, offset), cache_enabled)
    if not isinstance(index, dict) or not isinstance(index.get("playlist_ids"), list):
        return None
    if isinstance(index.get("playlists"), list):
        return index["playlists"]
    playlists = []
    for playlist_id in index["playlist_ids"]:
        playlist = read_json(cache_path(user_id, service, playlist_id), cache_enabled)
        if isinstance(playlist, dict):
            playlists.append(playlist)
    return playlists


def write_cached_page(user_id: int, service: str, limit: int, offset: int, playlists: list[dict]) -> None:
    cache_enabled = bool(config("cache.enabled", True))
    playlist_ids = []
    for playlist in playlists:
        playlist_id = playlist.get("id")
        if playlist_id is None:
            continue
        playlist_ids.append(playlist_id)
        write_json(cache_path(user_id, service, playlist_id), playlist, cache_enabled)
    write_json(
        page_path(user_id, service, limit, offset),
        {"version": 2, "playlist_ids": playlist_ids},
        cache_enabled,
    )


def read_full_cache(user_id: int, service: str):
    cache_enabled = bool(config("cache.enabled", True))
    data = read_json(full_path(user_id, service), cache_enabled)
    if not isinstance(data, dict) or not isinstance(data.get("playlists"), list):
        return None
    return data["playlists"]


def write_full_cache(user_id: int, service: str, playlists: list[dict]) -> None:
    write_json(full_path(user_id, service), {
        "version": 1,
        "cached_at": time.time(),
        "playlists": playlists,
    })


def start_refresh(key, target, *args) -> None:
    with _cache_lock:
        if key in _refreshing:
            return
        _refreshing.add(key)

    def run():
        try:
            target(*args)
        except Exception as error:
            log(f"Playlist cache refresh failed for {key}: {error}", "warning")
        finally:
            with _cache_lock:
                _refreshing.discard(key)

    Thread(target=run, name=f"playlist-cache-{key}", daemon=True).start()