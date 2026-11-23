import hashlib
import time
from omniplayr.plugins import log

from .cache import read_detail, read_song_cache, start_refresh, write_song_cache
from .config import REMOTE_SERVICES, SERVICE_LABELS, config
from .events import stream_event
from .local import get_local_playlist_summaries, local_playlist_song_events, add_playlist_collaborators
from .providers import get_page, refresh_detail, song_iterator, supports_song_streaming
from .state import get_db


def _stream_service_playlists(service, user, user_id, include_private, limit, start_offset):
    label = SERVICE_LABELS[service]
    load_all = bool(config(f"{service}.load_all_playlists", True))
    request_page_size = min(limit, 50, max(1, int(config(f"{service}.request_page_size", 50))))
    display_batch_size = max(1, int(config(f"{service}.display_batch_size", 10)))
    max_pages = max(1, int(config(f"{service}.max_playlist_pages", 100)))
    delay = max(0, int(config(f"{service}.display_batch_delay_ms", 50))) / 1000
    state = {"emitted": 0, "page": 0}

    def emit(playlists, cached):
        for batch_start in range(0, len(playlists), display_batch_size):
            if state["emitted"] >= limit:
                return
            batch = playlists[batch_start:batch_start + min(display_batch_size, limit - state["emitted"])]
            for playlist in batch:
                if include_private or not playlist.get("private", False):
                    yield stream_event("playlist", playlist=playlist, cached=cached, page=state["page"])
                    state["emitted"] += 1
            yield stream_event(
                "page",
                service=service,
                page=state["page"],
                count=len(batch),
                cached=cached,
            )
            state["page"] += 1
            if delay:
                time.sleep(delay)

    page_offset = start_offset
    try:
        for _page_number in range(max_pages):
            remaining = limit - state["emitted"]
            if remaining <= 0:
                break
            page_limit = min(request_page_size, remaining)
            playlists, cached = get_page(service, user_id, page_limit, page_offset, user, refresh_cached=True)
            if playlists is None:
                yield stream_event("error", service=service, message=f"{label} page request failed")
                break

            yield from emit(playlists, cached)

            page_for_pagination = playlists
            if state["emitted"] >= limit or not load_all or len(page_for_pagination) < page_limit:
                break
            page_offset += page_limit
    except Exception as error:
        log(f"{label} playlist stream failed: {error}", "error")
        yield stream_event("error", service=service, message=f"Failed to load {label} playlists")


def stream_playlists_events(user, user_id, token_user_id, include_private, requested_services, limit, offset, offsets):
    yield stream_event(
        "start",
        services=sorted(requested_services),
        limit=limit,
        offset=offset,
        spotify_offset=offsets["spotify"],
        soundcloud_offset=offsets["soundcloud"],
        youtube_offset=offsets["youtube"],
        user={"id": user["id"], "name": user["name"]},
    )

    if "local" in requested_services:
        try:
            for playlist in get_local_playlist_summaries(user_id, token_user_id, include_private, limit, offset):
                yield stream_event("playlist", playlist=playlist, cached=False)
        except Exception as error:
            log(f"Local playlist stream failed: {error}", "error")
            yield stream_event("error", service="local", message="Failed to load local playlists")

    for service in REMOTE_SERVICES:
        if service in requested_services:
            yield from _stream_service_playlists(
                service, user, user_id, include_private, limit, offsets[service]
            )

    yield stream_event("done")


def _local_playlist_events(raw_playlist_id, user_id, token_user_id):
    db = get_db()
    try:
        local_id = int(raw_playlist_id)
    except ValueError:
        yield stream_event("error", service="local", message="Invalid playlist ID")
        return
    playlist = db.fetch_one("playlists", where={"id": local_id, "owner_id": user_id})
    if not playlist or (playlist.get("private") and token_user_id != user_id):
        yield stream_event("error", service="local", message="Playlist not found")
        return
    playlist["service"] = "local"
    add_playlist_collaborators(playlist)
    yield stream_event("playlist", playlist=playlist, cached=False)
    yield from local_playlist_song_events(local_id, user_id)
    yield stream_event(
        "songs_done",
        service="local",
        count=db.count("playlist_songs", where={"playlist_id": local_id}),
        cached=False,
    )
    yield stream_event("done")


def _refresh_song_cache(service, user_id, token_user_id, user, raw_playlist_id):
    songs = []
    for raw_song in song_iterator(service, raw_playlist_id, user_id, token_user_id, user):
        if not isinstance(raw_song, dict):
            continue
        song = dict(raw_song)
        song["metadata"] = dict(song.get("metadata") or {})
        songs.append(song)
    write_song_cache(user_id, service, raw_playlist_id, songs, complete=True)


def _remote_song_events(service, user_id, token_user_id, user, raw_playlist_id):
    batch_size = max(1, int(config(f"{service}.song_display_batch_size", 20)))
    batch_delay = max(0, int(config(f"{service}.song_display_batch_delay_ms", 10))) / 1000
    cached_song_data = read_song_cache(user_id, service, raw_playlist_id, allow_incomplete=True)
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
                    write_song_cache(user_id, service, raw_playlist_id, cache_target, complete=False)

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
            yield stream_event("song", **event)
            count += 1
            if batch_delay and not cached and count % batch_size == 0:
                time.sleep(batch_delay)

    if cached_songs is not None:
        yield from song_events(cached_songs, cached=True)
        yield stream_event("songs_done", service=service, count=len(cached_songs), cached=True)

        if cached_song_data.get("complete"):
            cached_at = float(cached_song_data.get("cached_at") or 0)
            ttl = max(0, int(config("cache.song_ttl_seconds", 300)))
            stale = ttl == 0 or time.time() - cached_at >= ttl
            if stale and bool(config("cache.refresh_in_background", True)):
                start_refresh(
                    f"{service}-songs-{user_id}-{raw_playlist_id}",
                    _refresh_song_cache,
                    service,
                    user_id,
                    token_user_id,
                    user,
                    raw_playlist_id,
                )
            return

    fresh_songs = []
    live_songs = song_iterator(service, raw_playlist_id, user_id, token_user_id, user)
    yield from song_events(live_songs, cached=False, cache_target=fresh_songs)
    write_song_cache(user_id, service, raw_playlist_id, fresh_songs, complete=True)
    yield stream_event("songs_done", service=service, count=len(fresh_songs), cached=False)


def stream_playlist_events(user, user_id, token_user_id, raw_playlist_id, service, fast=False):
    yield stream_event("start", user={"id": user["id"], "name": user["name"]}, service=service)

    if service == "local":
        yield from _local_playlist_events(raw_playlist_id, user_id, token_user_id)
        return

    cached_playlist = read_detail(user_id, service, raw_playlist_id)
    if cached_playlist and cached_playlist.get("private") and token_user_id != user_id:
        yield stream_event("error", service=service, message="Playlist not found")
        return
    if cached_playlist:
        cached_playlist = dict(cached_playlist)
        cached_playlist.pop("songs", None)
        yield stream_event("playlist", playlist=cached_playlist, cached=True)

    if not fast:
        fresh_playlist = refresh_detail(service, raw_playlist_id, user_id, user)
        if fresh_playlist and not (fresh_playlist.get("private") and token_user_id != user_id):
            fresh_playlist = dict(fresh_playlist)
            fresh_playlist.pop("songs", None)
            yield stream_event("playlist", playlist=fresh_playlist, cached=False)
        elif not cached_playlist:
            yield stream_event("error", service=service, message="Playlist not found")
            return

    if not supports_song_streaming(service):
        yield stream_event("error", service=service, message=f"{service.title()} song streaming is unavailable")
        return

    try:
        yield from _remote_song_events(service, user_id, token_user_id, user, raw_playlist_id)
    except Exception as error:
        log(f"{service.title()} playlist songs stream failed: {error}", "error")
        yield stream_event("error", service=service, message=f"Failed to load {service.title()} songs")

    yield stream_event("done")