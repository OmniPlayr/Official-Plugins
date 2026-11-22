from fastapi import Body, Depends, Header, HTTPException, Query
from fastapi.responses import StreamingResponse
from omniplayr.plugins import api, log, verify_auth

from .accounts import load_user, require_user, resolve_user_id
from .cache import read_cached_page, read_full_cache, read_song_cache, write_song_cache
from .config import REMOTE_SERVICES, config, resolve_options, resolve_services, split_playlist_id
from .frequent import add_frequent_playlist, get_frequent_playlists
from .local import add_playlist_collaborators, get_local_playlist_summaries, local_playlist_songs, create_new_playlist
from .providers import get_detail, get_full, get_page, song_iterator, supports_song_streaming
from .queue_order import ordered_requested_playlist_songs
from .state import get_db
from .streaming import stream_playlist_events, stream_playlists_events

STREAM_HEADERS = {"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"}


def _visible(playlists, include_private):
    playlists = playlists or []
    if include_private:
        return playlists
    return [playlist for playlist in playlists if not playlist.get("private", False)]


@api.get("/playlists/{user_id}")
def get_playlists(
    user_id: str,
    limit: int | None = Query(None),
    offset: int | None = Query(None),
    services: str | None = Query(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, user = load_user(user_id, token_user_id)
    limit, offset, requested_services = resolve_options(limit, offset, services)
    include_private = token_user_id == resolved_user_id

    response = {
        "frequent": get_frequent_playlists(resolved_user_id),
        "playlists": [],
    }

    if "local" in requested_services:
        response["playlists"].extend(
            get_local_playlist_summaries(resolved_user_id, token_user_id, include_private, limit, offset)
        )

    for service in REMOTE_SERVICES:
        if service in requested_services:
            playlists, _ = get_page(service, resolved_user_id, limit, offset, user)
            response["playlists"].extend(_visible(playlists, include_private))

    return response


@api.get("/playlists/{user_id}/cached")
def get_cached_playlists(
    user_id: str,
    limit: int | None = Query(None),
    offset: int | None = Query(None),
    services: str | None = Query(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, _user = load_user(user_id, token_user_id)
    limit, offset, requested_services = resolve_options(limit, offset, services)
    include_private = token_user_id == resolved_user_id
    playlists = []

    if "local" in requested_services:
        playlists.extend(
            get_local_playlist_summaries(resolved_user_id, token_user_id, include_private, limit, offset)
        )

    for service in REMOTE_SERVICES:
        if service not in requested_services:
            continue
        cached = read_cached_page(resolved_user_id, service, limit, offset)
        if cached is None:
            continue
        playlists.extend(_visible(cached, include_private))

    return {
        "playlists": playlists,
        "frequent": get_frequent_playlists(resolved_user_id),
    }


@api.get("/playlists/{user_id}/sidebar")
def get_sidebar_playlists(
    user_id: str,
    services: str | None = Query(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, user = load_user(user_id, token_user_id)
    requested_services = resolve_services(services)
    include_private = token_user_id == resolved_user_id

    playlists = []
    if "local" in requested_services:
        playlists.extend(get_local_playlist_summaries(resolved_user_id, token_user_id, include_private))

    for service in REMOTE_SERVICES:
        if service in requested_services:
            service_playlists, _ = get_full(service, resolved_user_id, user)
            playlists.extend(_visible(service_playlists, include_private))

    return {
        "playlists": playlists,
        "frequent": get_frequent_playlists(resolved_user_id),
    }


@api.get("/playlists/{user_id}/sidebar/cached")
def get_cached_sidebar_playlists(
    user_id: str,
    services: str | None = Query(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, _user = load_user(user_id, token_user_id)
    requested_services = resolve_services(services)
    include_private = token_user_id == resolved_user_id

    playlists = []
    if "local" in requested_services:
        playlists.extend(get_local_playlist_summaries(resolved_user_id, token_user_id, include_private))

    for service in REMOTE_SERVICES:
        if service not in requested_services:
            continue
        cached = read_full_cache(resolved_user_id, service)
        if cached is None:
            continue
        playlists.extend(_visible(cached, include_private))

    return {
        "playlists": playlists,
        "frequent": get_frequent_playlists(resolved_user_id),
    }


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
    if not bool(config("streaming.enabled", True)):
        raise HTTPException(status_code=404, detail="Playlist streaming is disabled")

    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, user = load_user(user_id, token_user_id)
    limit, offset, requested_services = resolve_options(limit, offset, services)

    offsets = {
        "spotify": offset if spotify_offset is None else spotify_offset,
        "soundcloud": offset,
        "youtube": offset if youtube_offset is None else youtube_offset,
    }
    if offsets["spotify"] < 0:
        raise HTTPException(status_code=400, detail="spotify_offset must be at least 0")
    if offsets["youtube"] < 0:
        raise HTTPException(status_code=400, detail="youtube_offset must be at least 0")

    return StreamingResponse(
        stream_playlists_events(
            user,
            resolved_user_id,
            token_user_id,
            token_user_id == resolved_user_id,
            requested_services,
            limit,
            offset,
            offsets,
        ),
        media_type="application/x-ndjson",
        headers=STREAM_HEADERS,
    )


@api.get("/playlists/{user_id}/{playlist_id}/stream")
def stream_playlist(
    user_id: str,
    playlist_id: str,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, user = load_user(user_id, token_user_id)
    raw_playlist_id, service = split_playlist_id(playlist_id)

    return StreamingResponse(
        stream_playlist_events(user, resolved_user_id, token_user_id, raw_playlist_id, service),
        media_type="application/x-ndjson",
        headers=STREAM_HEADERS,
    )


@api.post("/playlists/{user_id}/{playlist_id}/queue")
def get_playlist_queue_songs(
    user_id: str,
    playlist_id: str,
    payload: dict | None = Body(None),
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id, user = load_user(user_id, token_user_id)
    raw_playlist_id, service = split_playlist_id(playlist_id)

    payload = payload or {}
    requested_songs = payload.get("songs") if isinstance(payload, dict) else None
    if not isinstance(requested_songs, list):
        requested_songs = []
    requested_songs = [
        song for song in requested_songs
        if isinstance(song, dict)
        and (song.get("song_id") or song.get("songId"))
        and (song.get("source_type") or song.get("sourceType"))
    ]
    if not requested_songs:
        return {"playlist": None, "songs": [], "complete": True}

    if service == "local":
        try:
            local_id = int(raw_playlist_id)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid playlist ID")
        playlist = get_db().fetch_one("playlists", where={"id": local_id, "owner_id": resolved_user_id})
        if not playlist or (playlist.get("private") and token_user_id != resolved_user_id):
            raise HTTPException(status_code=404, detail="Playlist not found")
        playlist["service"] = "local"

        playlist_songs = list(local_playlist_songs(local_id, resolved_user_id))
        ordered, missing = ordered_requested_playlist_songs(requested_songs, playlist_songs)
        return {
            "playlist": playlist,
            "songs": ordered,
            "complete": len(missing) == 0,
        }

    playlist = get_detail(service, raw_playlist_id, resolved_user_id)
    if not playlist or (playlist.get("private") and token_user_id != resolved_user_id):
        raise HTTPException(status_code=404, detail="Playlist not found")

    cached_song_data = read_song_cache(resolved_user_id, service, raw_playlist_id)
    cached_songs = cached_song_data.get("songs") if cached_song_data else []
    ordered, missing = ordered_requested_playlist_songs(requested_songs, cached_songs)

    if missing:
        if not supports_song_streaming(service):
            return {"playlist": playlist, "songs": ordered, "complete": False}

        try:
            live_source = song_iterator(service, raw_playlist_id, resolved_user_id, token_user_id, user)
            live_songs = []
            exhausted = True
            for live_song in live_source:
                live_songs.append(live_song)
                ordered, missing = ordered_requested_playlist_songs(requested_songs, live_songs)
                if not missing:
                    exhausted = False
                    break

            if exhausted:
                write_song_cache(resolved_user_id, service, raw_playlist_id, live_songs, complete=True)
                ordered, missing = ordered_requested_playlist_songs(requested_songs, live_songs)
        except Exception as error:
            log(f"{service.title()} ordered queue lookup failed: {error}", "error")

    return {
        "playlist": playlist,
        "songs": ordered,
        "complete": len(missing) == 0,
    }


@api.get("/playlists/{user_id}/{playlist_id}")
def get_playlist(
    user_id: str,
    playlist_id: str,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id = resolve_user_id(user_id, token_user_id)
    raw_playlist_id, service = split_playlist_id(playlist_id)

    if service != "local":
        playlist = get_detail(service, raw_playlist_id, resolved_user_id)
        if not playlist or (playlist.get("private") and token_user_id != resolved_user_id):
            raise HTTPException(status_code=404, detail="Playlist not found")
        add_frequent_playlist(raw_playlist_id, service, token_user_id)
        return playlist

    try:
        local_playlist_id = int(raw_playlist_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid local playlist ID")

    playlist = get_db().fetch_one("playlists", where={"id": local_playlist_id, "owner_id": resolved_user_id})
    if not playlist:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if playlist.get("private") and token_user_id != resolved_user_id:
        raise HTTPException(status_code=404, detail="Playlist not found")

    playlist["service"] = "local"
    add_playlist_collaborators(playlist)
    add_frequent_playlist(str(local_playlist_id), "local", token_user_id)
    return playlist

@api.post("/playlists/{user_id}/create")
def create_playlist(
    user_id: str,
    auth=Depends(verify_auth),
    x_account_token: str = Header(..., alias="X-Account-Token"),
):
    token_user_id = require_user(auth, x_account_token)
    resolved_user_id = resolve_user_id(user_id, token_user_id)
    return create_new_playlist(resolved_user_id)
    