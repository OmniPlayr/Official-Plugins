import json
import hashlib
import time
from pathlib import Path
from threading import RLock, Thread
from fastapi import Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from .services import soundcloud as soundcloud_service
from .services import spotify as spotify_service
from .services import youtube as youtube_service

from omniplayr.plugins import list_account_summaries, get_account, get_account_summary, get_plugin_config, api, get_plugin, has_function, verify_auth, get_token_user, log

PLUGIN_KEY = "playlists@built-in"
SUPPORTED_SERVICES = {"local", "spotify", "soundcloud", "youtube"}
DEFAULT_SERVICES = "local,spotify,soundcloud,youtube"
_db = None
_cache_lock = RLock()
_refreshing = set()


def _config(key, default=None):
    return get_plugin_config(PLUGIN_KEY, key, default=default)


def _cache_dir() -> Path:
    configured = Path(str(_config("cache.cache_dir", "user_storage/playlist-cache")))
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


def _safe_cache_part(value) -> str:
    return "".join(character for character in str(value) if character.isalnum() or character in "-_") or "unknown"


def _cache_path(user_id: int, service: str, playlist_id, detail: bool = False) -> Path:
    suffix = "detail-v2" if detail else "summary"
    return _cache_dir() / _safe_cache_part(user_id) / service / f"{_safe_cache_part(playlist_id)}.{suffix}.json"


def _page_path(user_id: int, service: str, limit: int, offset: int) -> Path:
    return _cache_dir() / _safe_cache_part(user_id) / service / f"page-{offset}-{limit}.json"


def _song_cache_path(user_id: int, service: str, playlist_id) -> Path:
    return _cache_dir() / _safe_cache_part(user_id) / service / f"{_safe_cache_part(playlist_id)}.songs-v1.json"


def _read_json(path: Path, cache_enabled=None):
    if cache_enabled is None:
        cache_enabled = bool(_config("cache.enabled", True))
    if not cache_enabled or not path.exists():
        return None
    try:
        with _cache_lock:
            return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write_json(path: Path, value, cache_enabled=None) -> None:
    if cache_enabled is None:
        cache_enabled = bool(_config("cache.enabled", True))
    if not cache_enabled:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    with _cache_lock:
        temporary.write_text(json.dumps(value, ensure_ascii=False, default=str), encoding="utf-8")
        temporary.replace(path)


def _read_song_cache(user_id: int, service: str, playlist_id):
    cached = _read_json(_song_cache_path(user_id, service, playlist_id))
    if not isinstance(cached, dict) or not cached.get("complete") or not isinstance(cached.get("songs"), list):
        return None
    for song in cached["songs"]:
        metadata = song.get("metadata") if isinstance(song, dict) else None
        if not isinstance(metadata, dict):
            return None
        if isinstance(song.get("added_by_picture"), dict) or isinstance(metadata.get("album_art"), dict):
            return None
    return cached


def _write_song_cache(user_id: int, service: str, playlist_id, songs: list[dict], complete: bool) -> None:
    _write_json(
        _song_cache_path(user_id, service, playlist_id),
        {
            "version": 1,
            "cached_at": time.time(),
            "complete": complete,
            "songs": songs,
        },
    )


def _read_cached_page(user_id: int, service: str, limit: int, offset: int):
    cache_enabled = bool(_config("cache.enabled", True))
    index = _read_json(_page_path(user_id, service, limit, offset), cache_enabled)
    if not isinstance(index, dict) or not isinstance(index.get("playlist_ids"), list):
        return None
    if isinstance(index.get("playlists"), list):
        return index["playlists"]
    playlists = []
    for playlist_id in index["playlist_ids"]:
        playlist = _read_json(_cache_path(user_id, service, playlist_id), cache_enabled)
        if isinstance(playlist, dict):
            playlists.append(playlist)
    return playlists


def _write_cached_page(user_id: int, service: str, limit: int, offset: int, playlists: list[dict]) -> None:
    cache_enabled = bool(_config("cache.enabled", True))
    playlist_ids = []
    for playlist in playlists:
        playlist_id = playlist.get("id")
        if playlist_id is None:
            continue
        playlist_ids.append(playlist_id)
        _write_json(_cache_path(user_id, service, playlist_id), playlist, cache_enabled)
    _write_json(
        _page_path(user_id, service, limit, offset),
        {"version": 2, "playlist_ids": playlist_ids},
        cache_enabled,
    )


def _start_refresh(key, target, *args) -> None:
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

def init(db) -> None:
    global _db
    _db = db
    
def create_liked_playlist(user_id: int):
    log(f"Creating liked playlist for user_id={user_id}", "debug")
    user = get_account_summary(user_id)
    if not user:
        log(f"User id={user_id} not found", "debug")
        return
    
    log(f"User id={user_id} found", "debug")
    has_liked = _db.fetch_one("playlists", where={"owner_id": user_id, "is_liked_playlist": True})
    if has_liked:
        log(f"User id={user_id} already has a liked playlist", "debug")
        return
    
    liked_playlist = _db.insert("playlists", {
        "name": "Liked Songs",
        "description": "Your liked songs",
        "private": True,
        "owner_id": user_id,
        "is_liked_playlist": True,
        "created_by": user_id,
    })
    if not liked_playlist:
        log(f"Failed to create liked playlist for user_id={user_id}", "debug")
        return
    
    log(f"Created liked playlist for user_id={user_id}", "debug")
    return liked_playlist

def list_playlists(user_id: int, include_private: bool = False):
    log(f"Listing playlists for user_id={user_id}", "debug")
    if include_private:
        log(f"Including private playlists for user_id={user_id}", "debug")
        return _db.fetch("playlists", where={"owner_id": user_id})
    else:
        log(f"Not including private playlists for user_id={user_id}", "debug")
        return _db.fetch("playlists", where={"owner_id": user_id, "private": False})

def add_playlist_collaborators(playlist, accounts=None, collaborators_by_playlist=None):
    owner_id = playlist.get("owner_id")
    owner = accounts.get(owner_id) if accounts is not None else get_account(owner_id)

    collaborators = []

    if owner:
        collaborators.append({
            "account_id": playlist.get("owner_id"),
            "permission": "owner",
            "name": owner.get("name"),
            "avatar": owner.get("avatar_b64")
        })

    if collaborators_by_playlist is None:
        rows = _db.fetch("playlist_collaborators", where={"playlist_id": playlist.get("id")})
    else:
        rows = collaborators_by_playlist.get(playlist.get("id"), [])

    for row in rows:
        account_id = row.get("account_id")
        account = accounts.get(account_id) if accounts is not None else get_account(account_id)

        collaborators.append({
            "account_id": account_id,
            "permission": row.get("permission"),
            "name": account.get("name") if account else row.get("name") or "Unknown User",
            "avatar": account.get("avatar_b64") if account else row.get("avatar")
        })

    playlist["collaborators"] = collaborators
    return playlist


def _resolve_options(limit, offset, services):
    default_limit = int(_config("pagination.default_limit", 20))
    default_offset = int(_config("pagination.default_offset", 0))
    max_limit = int(_config("pagination.max_limit", 50))
    resolved_limit = default_limit if limit is None else limit
    resolved_offset = default_offset if offset is None else offset

    if resolved_limit < 1 or resolved_limit > max_limit:
        raise HTTPException(status_code=400, detail=f"limit must be between 1 and {max_limit}")
    if resolved_offset < 0:
        raise HTTPException(status_code=400, detail="offset must be at least 0")

    configured_services = str(_config("providers.default_services", DEFAULT_SERVICES))
    if services is None and "youtube" not in {
        str(service).strip().lower()
        for service in configured_services.split(",")
        if str(service).strip()
    }:
        configured_services = f"{configured_services},youtube"
    requested = services.split(",") if services is not None else configured_services.split(",")
    requested_services = {
        "local" if str(service).strip().lower() == "omniplayr" else str(service).strip().lower()
        for service in requested
        if str(service).strip()
    }
    invalid_services = requested_services - SUPPORTED_SERVICES
    if not requested_services or invalid_services:
        invalid = ", ".join(sorted(invalid_services)) or "none"
        raise HTTPException(status_code=400, detail=f"Invalid playlist services: {invalid}")
    if not bool(_config("providers.check_spotify_playlists", True)):
        requested_services.discard("spotify")
    if not bool(_config("providers.check_soundcloud_playlists", True)):
        requested_services.discard("soundcloud")
    if not bool(_config("providers.check_youtube_playlists", True)):
        requested_services.discard("youtube")

    return resolved_limit, resolved_offset, requested_services


def _get_local_playlist_summaries(user_id: int, token_user_id: int, include_private: bool, limit: int, offset: int):
    create_liked_playlist(user_id)
    local_playlists = list_playlists(user_id, include_private)[offset:offset + limit]
    accounts = {account["id"]: account for account in list_account_summaries()}

    for playlist in local_playlists:
        playlist["service"] = "local"
        created_by = playlist.get("created_by")
        creator = accounts.get(created_by) if created_by is not None else None
        if creator is None:
            if created_by is not None:
                playlist["created_by"] = None
            playlist["created_by_name"] = "Unknown User"
        elif created_by == token_user_id:
            playlist["created_by_name"] = "You"
        elif playlist.get("created_by_name") is None:
            playlist["created_by_name"] = creator["name"]
        playlist.pop("created_by_avatar", None)
        playlist.pop("collaborators", None)

    return local_playlists


def _refresh_spotify_page(user_id: int, limit: int, offset: int, local_owner):
    playlists = spotify_service.get_playlists(
        user_id=user_id,
        limit=limit,
        offset=offset,
        local_owner=local_owner,
        config=_config,
    )
    if playlists is not None:
        _write_cached_page(user_id, "spotify", limit, offset, playlists)
    return playlists


def _get_spotify_page(user_id: int, limit: int, offset: int, local_owner, refresh_cached=True):
    cached = _read_cached_page(user_id, "spotify", limit, offset)
    refresh_key = f"spotify-page-{user_id}-{offset}-{limit}"
    if cached is not None:
        if refresh_cached and bool(_config("cache.refresh_in_background", True)):
            _start_refresh(refresh_key, _refresh_spotify_page, user_id, limit, offset, local_owner)
        return cached, True
    return _refresh_spotify_page(user_id, limit, offset, local_owner), False


def _refresh_soundcloud_page(user_id: int, limit: int, offset: int, local_owner):
    playlists = soundcloud_service.get_playlists(
        user_id=user_id,
        limit=limit,
        offset=offset,
        local_owner=local_owner,
        config=_config,
    )
    if playlists is not None:
        _write_cached_page(user_id, "soundcloud", limit, offset, playlists)
    return playlists


def _get_soundcloud_page(user_id: int, limit: int, offset: int, local_owner, refresh_cached=True):
    cached = _read_cached_page(user_id, "soundcloud", limit, offset)
    refresh_key = f"soundcloud-page-{user_id}-{offset}-{limit}"
    if cached is not None:
        if refresh_cached and bool(_config("cache.refresh_in_background", True)):
            _start_refresh(refresh_key, _refresh_soundcloud_page, user_id, limit, offset, local_owner)
        return cached, True
    return _refresh_soundcloud_page(user_id, limit, offset, local_owner), False


def _refresh_youtube_page(user_id: int, limit: int, offset: int, local_owner):
    playlists = youtube_service.get_playlists(
        user_id=user_id,
        limit=limit,
        offset=offset,
        local_owner=local_owner,
        config=_config,
    )
    if playlists is not None:
        _write_cached_page(user_id, "youtube", limit, offset, playlists)
    return playlists


def _get_youtube_page(user_id: int, limit: int, offset: int, local_owner, refresh_cached=True):
    cached = _read_cached_page(user_id, "youtube", limit, offset)
    refresh_key = f"youtube-page-{user_id}-{offset}-{limit}"
    if cached is not None:
        if refresh_cached and bool(_config("cache.refresh_in_background", True)):
            _start_refresh(refresh_key, _refresh_youtube_page, user_id, limit, offset, local_owner)
        return cached, True
    return _refresh_youtube_page(user_id, limit, offset, local_owner), False


@api.get("/playlists/{user_id}")
def get_playlists(
    user_id: int,
    limit: int | None = Query(None),
    offset: int | None = Query(None),
    services: str | None = Query(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    log(f"GET /playlists/{user_id} requested", "debug")
    if not auth:
        log(f"GET /playlists/{user_id}: auth check failed", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not x_account_token:
        log(f"GET /playlists/{user_id}: missing account token header", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")
    token_user_id = get_token_user(x_account_token)
    if not token_user_id:
        log(f"GET /playlists/{user_id}: account token resolved to no account", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")
    log(f"GET /playlists/{user_id}: auth ok, getting playlists", "debug")
    user = get_account_summary(user_id)
    if not user:
        log(f"GET /playlists/{user_id}: user not found", "debug")
        raise HTTPException(status_code=404, detail="User not found")
    
    limit, offset, requested_services = _resolve_options(limit, offset, services)
    
    include_private = token_user_id == user_id
    if include_private:
        log(f"GET /playlists/{user_id}: match ok, including private playlists", "debug")
    
    response = []

    if "local" in requested_services:
        log(f"GET /playlists/{user_id}: getting local playlists", "debug")
        response.extend(_get_local_playlist_summaries(user_id, token_user_id, include_private, limit, offset))

    if "spotify" in requested_services:
        spotify_playlists, _ = _get_spotify_page(user_id, limit, offset, user)
        spotify_playlists = spotify_playlists or []
        if not include_private:
            spotify_playlists = [playlist for playlist in spotify_playlists if not playlist["private"]]
        response.extend(spotify_playlists)

    if "soundcloud" in requested_services:
        soundcloud_playlists, _ = _get_soundcloud_page(user_id, limit, offset, user)
        soundcloud_playlists = soundcloud_playlists or []
        if not include_private:
            soundcloud_playlists = [playlist for playlist in soundcloud_playlists if not playlist["private"]]
        response.extend(soundcloud_playlists)

    if "youtube" in requested_services:
        youtube_playlists, _ = _get_youtube_page(user_id, limit, offset, user)
        youtube_playlists = youtube_playlists or []
        if not include_private:
            youtube_playlists = [playlist for playlist in youtube_playlists if not playlist["private"]]
        response.extend(youtube_playlists)
    
    log(f"GET /playlists/{user_id}: returning response", "debug")
    
    return response


def _stream_event(event_type: str, **payload) -> bytes:
    return (json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=str) + "\n").encode("utf-8")


def _local_playlist_song_events(playlist_id: int, account_id: int):
    rows = _db.fetch("playlist_songs", where={"playlist_id": playlist_id}, order_by="position")
    accounts = {account["id"]: account for account in list_account_summaries()}

    for row in rows:
        source_type = row.get("source_type")
        song_id = row.get("song_id")
        plugin = get_plugin(source_type) if source_type else None
        metadata = {}

        if plugin and song_id:
            try:
                metadata = plugin.get_metadata(song_id, account_id) or {}
            except Exception as error:
                log(f"Failed to load metadata for local playlist song {source_type}:{song_id}: {error}", "warning")

        added_by = row.get("added_by")
        added_by_account = accounts.get(added_by)

        yield _stream_event(
            "song",
            song={
                "source_type": source_type,
                "song_id": song_id,
                "path": row.get("path"),
                "position": row.get("position"),
                "added_at": row.get("added_at"),
                "added_by": added_by,
                "added_by_name": added_by_account.get("name") if added_by_account else None,
                "added_by_picture": added_by_account.get("avatar_b64") if added_by_account else None,
                "spotify_uri": None,
                "metadata": {
                    "title": metadata.get("title") or metadata.get("filename") or song_id or "Unknown Track",
                    "artist": metadata.get("artist") or "Unknown Artist",
                    "album": metadata.get("album") or "Unknown Album",
                    "album_artist": metadata.get("album_artist") or metadata.get("artist") or "Unknown Artist",
                    "year": metadata.get("year"),
                    "track": metadata.get("track"),
                    "duration": metadata.get("duration") or 0,
                    "album_art": metadata.get("album_art"),
                    "explicit": bool(metadata.get("explicit", False)),
                },
            },
            cached=False,
        )


@api.get("/playlists/{user_id}/stream")
def stream_playlists(
    user_id: str,
    limit: int | None = Query(None),
    offset: int | None = Query(None),
    spotify_offset: int | None = Query(None),
    youtube_offset: int | None = Query(None),
    services: str | None = Query(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    if not bool(_config("streaming.enabled", True)):
        raise HTTPException(status_code=404, detail="Playlist streaming is disabled")
    if not auth or not x_account_token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    token_user_id = get_token_user(x_account_token)
    if not token_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if user_id.lower() == "me":
        resolved_user_id = token_user_id
    else:
        try:
            resolved_user_id = int(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user ID")

    user = get_account_summary(resolved_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    limit, offset, requested_services = _resolve_options(limit, offset, services)
    resolved_spotify_offset = offset if spotify_offset is None else spotify_offset
    resolved_soundcloud_offset = offset
    resolved_youtube_offset = offset if youtube_offset is None else youtube_offset
    if resolved_spotify_offset < 0:
        raise HTTPException(status_code=400, detail="spotify_offset must be at least 0")
    if resolved_youtube_offset < 0:
        raise HTTPException(status_code=400, detail="youtube_offset must be at least 0")
    include_private = token_user_id == resolved_user_id

    def generate():
        yield _stream_event(
            "start",
            services=sorted(requested_services),
            limit=limit,
            offset=offset,
            spotify_offset=resolved_spotify_offset,
            soundcloud_offset=resolved_soundcloud_offset,
            youtube_offset=resolved_youtube_offset,
            user={"id": user["id"], "name": user["name"]},
        )

        if "local" in requested_services:
            try:
                local_playlists = _get_local_playlist_summaries(
                    resolved_user_id, token_user_id, include_private, limit, offset
                )
                for playlist in local_playlists:
                    yield _stream_event("playlist", playlist=playlist, cached=False)
            except Exception as error:
                log(f"Local playlist stream failed: {error}", "error")
                yield _stream_event("error", service="local", message="Failed to load local playlists")

        if "spotify" in requested_services:
            try:
                load_all = bool(_config("spotify.load_all_playlists", True))
                request_page_size = min(limit, 50, max(1, int(_config("spotify.request_page_size", 50))))
                display_batch_size = max(1, int(_config("spotify.display_batch_size", 10)))
                max_pages = max(1, int(_config("spotify.max_playlist_pages", 100)))
                delay = max(0, int(_config("spotify.display_batch_delay_ms", 50))) / 1000
                page_offset = resolved_spotify_offset
                display_page = 0
                emitted_count = 0

                for page_number in range(max_pages):
                    remaining = limit - emitted_count
                    if remaining <= 0:
                        break
                    page_limit = min(request_page_size, remaining)
                    spotify_playlists, cached = _get_spotify_page(
                        resolved_user_id,
                        page_limit,
                        page_offset,
                        user,
                        refresh_cached=False,
                    )
                    if spotify_playlists is None:
                        yield _stream_event(
                            "error", service="spotify", message="Spotify page request failed"
                        )
                        break

                    for batch_start in range(0, len(spotify_playlists), display_batch_size):
                        if emitted_count >= limit:
                            break
                        batch = spotify_playlists[
                            batch_start:batch_start + min(display_batch_size, limit - emitted_count)
                        ]
                        for playlist in batch:
                            if include_private or not playlist.get("private", False):
                                yield _stream_event(
                                    "playlist",
                                    playlist=playlist,
                                    cached=cached,
                                    page=display_page,
                                )
                                emitted_count += 1
                        yield _stream_event(
                            "page",
                            service="spotify",
                            page=display_page,
                            count=len(batch),
                            cached=cached,
                        )
                        display_page += 1
                        if delay:
                            time.sleep(delay)

                    page_for_pagination = spotify_playlists
                    if cached and emitted_count < limit:
                        fresh_playlists = _refresh_spotify_page(
                            resolved_user_id, page_limit, page_offset, user
                        )
                        if fresh_playlists is None:
                            yield _stream_event(
                                "error", service="spotify", message="Spotify refresh failed"
                            )
                            break
                        for batch_start in range(0, len(fresh_playlists), display_batch_size):
                            if emitted_count >= limit:
                                break
                            batch = fresh_playlists[
                                batch_start:batch_start + min(display_batch_size, limit - emitted_count)
                            ]
                            for playlist in batch:
                                if include_private or not playlist.get("private", False):
                                    yield _stream_event(
                                        "playlist",
                                        playlist=playlist,
                                        cached=False,
                                        page=display_page,
                                    )
                                    emitted_count += 1
                            yield _stream_event(
                                "page",
                                service="spotify",
                                page=display_page,
                                count=len(batch),
                                cached=False,
                            )
                            display_page += 1
                            if delay:
                                time.sleep(delay)
                        page_for_pagination = fresh_playlists

                    if emitted_count >= limit or not load_all or len(page_for_pagination) < page_limit:
                        break
                    page_offset += page_limit
            except Exception as error:
                log(f"Spotify playlist stream failed: {error}", "error")
                yield _stream_event("error", service="spotify", message="Failed to load Spotify playlists")

        if "soundcloud" in requested_services:
            try:
                load_all = bool(_config("soundcloud.load_all_playlists", True))
                request_page_size = min(limit, 50, max(1, int(_config("soundcloud.request_page_size", 50))))
                display_batch_size = max(1, int(_config("soundcloud.display_batch_size", 10)))
                max_pages = max(1, int(_config("soundcloud.max_playlist_pages", 100)))
                delay = max(0, int(_config("soundcloud.display_batch_delay_ms", 50))) / 1000
                page_offset = resolved_soundcloud_offset
                display_page = 0
                emitted_count = 0

                for _page_number in range(max_pages):
                    remaining = limit - emitted_count
                    if remaining <= 0:
                        break
                    page_limit = min(request_page_size, remaining)
                    soundcloud_playlists, cached = _get_soundcloud_page(
                        resolved_user_id,
                        page_limit,
                        page_offset,
                        user,
                        refresh_cached=False,
                    )
                    if soundcloud_playlists is None:
                        yield _stream_event("error", service="soundcloud", message="SoundCloud page request failed")
                        break

                    for batch_start in range(0, len(soundcloud_playlists), display_batch_size):
                        if emitted_count >= limit:
                            break
                        batch = soundcloud_playlists[
                            batch_start:batch_start + min(display_batch_size, limit - emitted_count)
                        ]
                        for playlist in batch:
                            if include_private or not playlist.get("private", False):
                                yield _stream_event("playlist", playlist=playlist, cached=cached, page=display_page)
                                emitted_count += 1
                        yield _stream_event(
                            "page",
                            service="soundcloud",
                            page=display_page,
                            count=len(batch),
                            cached=cached,
                        )
                        display_page += 1
                        if delay:
                            time.sleep(delay)

                    if emitted_count >= limit or not load_all or len(soundcloud_playlists) < page_limit:
                        break
                    page_offset += page_limit
            except Exception as error:
                log(f"SoundCloud playlist stream failed: {error}", "error")
                yield _stream_event("error", service="soundcloud", message="Failed to load SoundCloud playlists")

        if "youtube" in requested_services:
            try:
                load_all = bool(_config("youtube.load_all_playlists", True))
                request_page_size = min(limit, 50, max(1, int(_config("youtube.request_page_size", 50))))
                display_batch_size = max(1, int(_config("youtube.display_batch_size", 10)))
                max_pages = max(1, int(_config("youtube.max_playlist_pages", 100)))
                delay = max(0, int(_config("youtube.display_batch_delay_ms", 50))) / 1000
                page_offset = resolved_youtube_offset
                display_page = 0
                emitted_count = 0

                for _page_number in range(max_pages):
                    remaining = limit - emitted_count
                    if remaining <= 0:
                        break
                    page_limit = min(request_page_size, remaining)
                    youtube_playlists, cached = _get_youtube_page(
                        resolved_user_id,
                        page_limit,
                        page_offset,
                        user,
                        refresh_cached=False,
                    )
                    if youtube_playlists is None:
                        log(
                            f"YouTube Music stream page returned None "
                            f"(user_id={resolved_user_id}, limit={page_limit}, offset={page_offset})",
                            "debug",
                        )
                        yield _stream_event("error", service="youtube", message="YouTube Music page request failed")
                        break

                    for batch_start in range(0, len(youtube_playlists), display_batch_size):
                        if emitted_count >= limit:
                            break
                        batch = youtube_playlists[
                            batch_start:batch_start + min(display_batch_size, limit - emitted_count)
                        ]
                        for playlist in batch:
                            if include_private or not playlist.get("private", False):
                                yield _stream_event("playlist", playlist=playlist, cached=cached, page=display_page)
                                emitted_count += 1
                        yield _stream_event(
                            "page",
                            service="youtube",
                            page=display_page,
                            count=len(batch),
                            cached=cached,
                        )
                        display_page += 1
                        if delay:
                            time.sleep(delay)

                    if emitted_count >= limit or not load_all or len(youtube_playlists) < page_limit:
                        break
                    page_offset += page_limit
            except Exception as error:
                log(f"YouTube Music playlist stream failed: {error}", "error")
                yield _stream_event("error", service="youtube", message="Failed to load YouTube Music playlists")

        yield _stream_event("done")

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
        },
    )


@api.get("/playlists/{user_id}/{playlist_id}/stream")
def stream_playlist(
    user_id: str,
    playlist_id: str,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    if not auth or not x_account_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    token_user_id = get_token_user(x_account_token)
    if not token_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")

    if user_id.lower() == "me":
        resolved_user_id = token_user_id
    else:
        try:
            resolved_user_id = int(user_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid user ID")

    user = get_account_summary(resolved_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if ":" in playlist_id:
        raw_playlist_id, service = playlist_id.rsplit(":", 1)
        service = service.lower()
    else:
        raw_playlist_id, service = playlist_id, "local"
    if service == "omniplayr":
        service = "local"
    if service not in {"local", "spotify", "soundcloud", "youtube"}:
        raise HTTPException(status_code=400, detail=f"Unsupported playlist service: {service}")

    def generate():
        yield _stream_event("start", user={"id": user["id"], "name": user["name"]}, service=service)

        if service == "local":
            try:
                local_id = int(raw_playlist_id)
            except ValueError:
                yield _stream_event("error", service="local", message="Invalid playlist ID")
                return
            playlist = _db.fetch_one("playlists", where={"id": local_id, "owner_id": resolved_user_id})
            if not playlist or (playlist.get("private") and token_user_id != resolved_user_id):
                yield _stream_event("error", service="local", message="Playlist not found")
                return
            playlist["service"] = "local"
            add_playlist_collaborators(playlist)
            yield _stream_event("playlist", playlist=playlist, cached=False)
            yield from _local_playlist_song_events(local_id, resolved_user_id)
            yield _stream_event(
                "songs_done",
                service="local",
                count=_db.count("playlist_songs", where={"playlist_id": local_id}),
                cached=False,
            )
            yield _stream_event("done")
            return

        cached_playlist = _read_json(_cache_path(resolved_user_id, service, raw_playlist_id, detail=True))
        if cached_playlist and cached_playlist.get("private") and token_user_id != resolved_user_id:
            yield _stream_event("error", service=service, message="Playlist not found")
            return
        if cached_playlist:
            cached_playlist = dict(cached_playlist)
            cached_playlist.pop("songs", None)
            yield _stream_event("playlist", playlist=cached_playlist, cached=True)

        if service == "spotify":
            fresh_playlist = _refresh_spotify_detail(raw_playlist_id, resolved_user_id, user)
        elif service == "soundcloud":
            fresh_playlist = _refresh_soundcloud_detail(raw_playlist_id, resolved_user_id, user)
        else:
            fresh_playlist = _refresh_youtube_detail(raw_playlist_id, resolved_user_id, user)
        if fresh_playlist and not (
            fresh_playlist.get("private") and token_user_id != resolved_user_id
        ):
            fresh_playlist = dict(fresh_playlist)
            fresh_playlist.pop("songs", None)
            yield _stream_event("playlist", playlist=fresh_playlist, cached=False)
        elif not cached_playlist:
            yield _stream_event("error", service=service, message="Playlist not found")
            return

        provider_key = {
            "spotify": "spotify@built-in",
            "soundcloud": "soundcloud@built-in",
            "youtube": "youtube@built-in",
        }[service]
        if not has_function(provider_key, "iter_playlist_songs"):
            yield _stream_event(
                "error", service=service, message=f"{service.title()} song streaming is unavailable"
            )
            return

        try:
            batch_size = max(1, int(_config(f"{service}.song_display_batch_size", 20)))
            batch_delay = max(0, int(_config(f"{service}.song_display_batch_delay_ms", 10))) / 1000
            cached_song_data = _read_song_cache(resolved_user_id, service, raw_playlist_id)
            cached_songs = cached_song_data.get("songs") if cached_song_data else None
            emitted_images: set[str] = set()

            def song_events(source, cached: bool, cache_target=None):
                count = 0
                for raw_song in source:
                    song = dict(raw_song)
                    if cache_target is not None:
                        cache_target.append({
                            **song,
                            "metadata": dict(song.get("metadata") or {}),
                        })
                        if cached_songs is None and len(cache_target) % batch_size == 0:
                            _write_song_cache(
                                resolved_user_id,
                                service,
                                raw_playlist_id,
                                cache_target,
                                complete=False,
                            )

                    event_images = []

                    def image_reference(asset):
                        if not asset or not isinstance(asset, str):
                            return None
                        asset_id = hashlib.sha256(asset.encode("utf-8")).hexdigest()[:12]
                        if asset_id not in emitted_images:
                            emitted_images.add(asset_id)
                            event_images.append({"id": asset_id, "asset": asset})
                        return {"asset_id": asset_id}

                    if song.get("added_by_picture"):
                        song["added_by_picture"] = image_reference(song["added_by_picture"])

                    metadata = dict(song.get("metadata") or {})
                    if metadata.get("album_art"):
                        metadata["album_art"] = image_reference(metadata["album_art"])
                    song["metadata"] = metadata

                    event = {"song": song, "cached": cached}
                    if event_images:
                        event["images"] = event_images
                    yield _stream_event("song", **event)
                    count += 1
                    if batch_delay and count % batch_size == 0:
                        time.sleep(batch_delay)

            if cached_songs is not None:
                yield from song_events(cached_songs, cached=True)
                yield _stream_event(
                    "songs_done", service=service, count=len(cached_songs), cached=True
                )

            fresh_songs = []
            if service == "spotify":
                live_songs = spotify_service.song_iterator(raw_playlist_id, resolved_user_id, token_user_id, user, _config)
            elif service == "soundcloud":
                live_songs = soundcloud_service.song_iterator(raw_playlist_id, resolved_user_id, token_user_id, user, _config)
            else:
                live_songs = youtube_service.song_iterator(raw_playlist_id, resolved_user_id, token_user_id, user, _config)
            yield from song_events(live_songs, cached=False, cache_target=fresh_songs)
            _write_song_cache(
                resolved_user_id, service, raw_playlist_id, fresh_songs, complete=True
            )
            yield _stream_event(
                "songs_done", service=service, count=len(fresh_songs), cached=False
            )
        except Exception as error:
            log(f"{service.title()} playlist songs stream failed: {error}", "error")
            yield _stream_event("error", service=service, message=f"Failed to load {service.title()} songs")

        yield _stream_event("done")

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
    
@api.get("/playlists/{user_id}/{playlist_id}")
def get_playlist(user_id: int, playlist_id: str, auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    log(f"GET /playlists/{user_id}/{playlist_id} requested", "debug")
    if not auth:
        log(f"GET /playlists/{user_id}/{playlist_id}: auth check failed", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not x_account_token:
        log(f"GET /playlists/{user_id}/{playlist_id}: missing account token header", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")
    token_user_id = get_token_user(x_account_token)
    if not token_user_id:
        log(f"GET /playlists/{user_id}/{playlist_id}: account token resolved to no account", "debug")
        raise HTTPException(status_code=401, detail="Unauthorized")

    if ":" in playlist_id:
        raw_playlist_id, service = playlist_id.rsplit(":", 1)
        service = service.lower()
    else:
        raw_playlist_id, service = playlist_id, "local"

    if service == "omniplayr":
        service = "local"

    log(f"GET /playlists/{user_id}/{playlist_id}: auth ok, getting {service} playlist", "debug")

    if service == "spotify":
        playlist = get_spotify_playlist(raw_playlist_id, user_id)
        if not playlist or (playlist["private"] and token_user_id != user_id):
            raise HTTPException(status_code=404, detail="Playlist not found")
        return playlist

    if service == "soundcloud":
        playlist = get_soundcloud_playlist(raw_playlist_id, user_id)
        if not playlist or (playlist["private"] and token_user_id != user_id):
            raise HTTPException(status_code=404, detail="Playlist not found")
        return playlist

    if service == "youtube":
        playlist = get_youtube_playlist(raw_playlist_id, user_id)
        if not playlist or (playlist["private"] and token_user_id != user_id):
            raise HTTPException(status_code=404, detail="Playlist not found")
        return playlist

    if service != "local":
        raise HTTPException(status_code=400, detail=f"Unsupported playlist service: {service}")

    try:
        local_playlist_id = int(raw_playlist_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid local playlist ID")

    playlist = _db.fetch_one("playlists", where={"id": local_playlist_id, "owner_id": user_id})
    if not playlist:
        log(f"GET /playlists/{user_id}/{playlist_id}: playlist not found", "debug")
        raise HTTPException(status_code=404, detail="Playlist not found")
    if playlist.get("private") and token_user_id != user_id:
        raise HTTPException(status_code=404, detail="Playlist not found")

    playlist["service"] = "local"
    add_playlist_collaborators(playlist)
    return playlist


def _refresh_spotify_detail(playlist_id: str, user_id: int, local_owner):
    playlist = spotify_service.refresh_detail(playlist_id, user_id, local_owner, _config)
    if playlist is not None:
        _write_json(_cache_path(user_id, "spotify", playlist_id, detail=True), playlist)
    return playlist


def _refresh_spotify_detail_for_user(playlist_id: str, user_id: int):
    return _refresh_spotify_detail(playlist_id, user_id, get_account(user_id))


def get_spotify_playlist(playlist_id: str, user_id: int):
    cached = _read_json(_cache_path(user_id, "spotify", playlist_id, detail=True))
    if isinstance(cached, dict):
        if bool(_config("cache.refresh_in_background", True)):
            _start_refresh(
                f"spotify-detail-{user_id}-{playlist_id}",
                _refresh_spotify_detail_for_user,
                playlist_id,
                user_id,
            )
        return cached
    return _refresh_spotify_detail_for_user(playlist_id, user_id)


def _refresh_soundcloud_detail(playlist_id: str, user_id: int, local_owner):
    playlist = soundcloud_service.refresh_detail(playlist_id, user_id, local_owner, _config)
    if playlist is not None:
        _write_json(_cache_path(user_id, "soundcloud", playlist_id, detail=True), playlist)
    return playlist


def _refresh_soundcloud_detail_for_user(playlist_id: str, user_id: int):
    return _refresh_soundcloud_detail(playlist_id, user_id, get_account(user_id))


def get_soundcloud_playlist(playlist_id: str, user_id: int):
    cached = _read_json(_cache_path(user_id, "soundcloud", playlist_id, detail=True))
    if isinstance(cached, dict):
        if bool(_config("cache.refresh_in_background", True)):
            _start_refresh(
                f"soundcloud-detail-{user_id}-{playlist_id}",
                _refresh_soundcloud_detail_for_user,
                playlist_id,
                user_id,
            )
        return cached
    return _refresh_soundcloud_detail_for_user(playlist_id, user_id)


def _refresh_youtube_detail(playlist_id: str, user_id: int, local_owner):
    playlist = youtube_service.refresh_detail(playlist_id, user_id, local_owner, _config)
    if playlist is not None:
        _write_json(_cache_path(user_id, "youtube", playlist_id, detail=True), playlist)
    return playlist


def _refresh_youtube_detail_for_user(playlist_id: str, user_id: int):
    return _refresh_youtube_detail(playlist_id, user_id, get_account(user_id))


def get_youtube_playlist(playlist_id: str, user_id: int):
    cached = _read_json(_cache_path(user_id, "youtube", playlist_id, detail=True))
    if isinstance(cached, dict):
        if bool(_config("cache.refresh_in_background", True)):
            _start_refresh(
                f"youtube-detail-{user_id}-{playlist_id}",
                _refresh_youtube_detail_for_user,
                playlist_id,
                user_id,
            )
        return cached
    return _refresh_youtube_detail_for_user(playlist_id, user_id)


def get_spotify_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return spotify_service.get_playlists(
        limit=limit,
        offset=offset,
        user_id=user_id,
        local_owner=local_owner,
        config=_config,
    )


def get_soundcloud_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return soundcloud_service.get_playlists(
        limit=limit,
        offset=offset,
        user_id=user_id,
        local_owner=local_owner,
        config=_config,
    )


def get_youtube_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return youtube_service.get_playlists(
        limit=limit,
        offset=offset,
        user_id=user_id,
        local_owner=local_owner,
        config=_config,
    )
