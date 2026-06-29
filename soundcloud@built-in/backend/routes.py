import base64
import hashlib
import secrets
import time
from threading import RLock
from urllib.parse import urlencode, urlparse, urlunparse

import requests as http_requests
from api.helpers.log import log
from api.helpers.plugin_config import get_plugin_config
from api.helpers.plugins import api, expose
from api.helpers.server import get_token_user, verify_auth
from fastapi import Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

PLUGIN_KEY = "soundcloud@built-in"

_db = None
_pkce_store: dict[str, dict] = {}
_playlist_cache: dict[tuple[int, int, int], tuple[float, list[dict]]] = {}
_playlist_cache_lock = RLock()
_access_token_cache: dict[int, tuple[str, int]] = {}
_access_token_cache_lock = RLock()


def init(db) -> None:
    global _db
    _db = db


def _account_token(request: Request) -> str:
    return request.headers.get("X-Account-Token", "") or ""


def _get_row(account_id: int) -> dict | None:
    return _db.fetch_one("soundcloud_accounts", where={"account_id": account_id})


def _config(key: str, default=None):
    return get_plugin_config(PLUGIN_KEY, key, default=default)


def _api_base() -> str:
    return str(_config("api.base_url", "https://api.soundcloud.com")).rstrip("/")


def _auth_base() -> str:
    return str(_config("api.auth_base_url", "https://secure.soundcloud.com")).rstrip("/")


def _oembed_base() -> str:
    return str(_config("api.oembed_base_url", "https://soundcloud.com/oembed")).rstrip("/")


def _timeout(default: int = 10) -> int:
    return max(1, int(_config("requests.timeout_seconds", default)))


def _base_url(request: Request) -> str:
    parsed = urlparse(str(request.base_url).rstrip("/"))
    is_local = parsed.hostname in ("localhost", "127.0.0.1")
    scheme = "http" if is_local else "https"
    return urlunparse((scheme, parsed.netloc, parsed.path, "", "", "")).rstrip("/")


def _auth_headers(access_token: str) -> dict:
    return {"Authorization": f"OAuth {access_token}"}


def _token_request(data: dict, row: dict | None = None):
    if row:
        data = {**data, "client_id": row["client_id"], "client_secret": row["client_secret"]}
    return http_requests.post(f"{_auth_base()}/oauth/token", data=data, timeout=_timeout(15))


def get_access_token(account_id: int) -> str | None:
    now_ms = int(time.time() * 1000)
    with _access_token_cache_lock:
        cached = _access_token_cache.get(account_id)
        if cached and now_ms < cached[1] - 60_000:
            return cached[0]

    row = _get_row(account_id)
    if not row or not row.get("refresh_token"):
        return None

    if row.get("access_token") and row.get("token_expiry") and now_ms < int(row["token_expiry"]) - 60_000:
        with _access_token_cache_lock:
            _access_token_cache[account_id] = (row["access_token"], int(row["token_expiry"]))
        return row["access_token"]

    try:
        res = _token_request({"grant_type": "refresh_token", "refresh_token": row["refresh_token"]}, row)
    except http_requests.RequestException:
        return None

    if not res.ok:
        log(f"SoundCloud token refresh failed: status={res.status_code}", "warning")
        return None

    data = res.json()
    expiry = now_ms + int(data.get("expires_in", 3600)) * 1000
    _db.update(
        "soundcloud_accounts",
        data={
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", row["refresh_token"]),
            "token_expiry": expiry,
        },
        where={"account_id": account_id},
    )
    with _access_token_cache_lock:
        _access_token_cache[account_id] = (data["access_token"], expiry)
    return data["access_token"]


def _request(account_id: int, path_or_url: str, params=None, timeout_seconds: int = 10):
    token = get_access_token(account_id)
    if not token:
        return None
    url = path_or_url if path_or_url.startswith("http") else f"{_api_base()}{path_or_url}"
    try:
        return http_requests.get(url, headers=_auth_headers(token), params=params, timeout=timeout_seconds)
    except http_requests.RequestException as error:
        log(f"SoundCloud request failed: {error}", "warning")
        return None


def _first_artwork(item: dict) -> str | None:
    value = item.get("artwork_url") or item.get("avatar_url")
    if isinstance(value, str):
        return value.replace("-large.", "-t500x500.")
    user = item.get("user") or {}
    if isinstance(user, dict) and isinstance(user.get("avatar_url"), str):
        return user["avatar_url"].replace("-large.", "-t500x500.")
    return None


def _user_profile(account_id: int, timeout_seconds: int = 10) -> dict | None:
    row = _get_row(account_id)
    if row and row.get("soundcloud_user_id"):
        return {
            "id": row["soundcloud_user_id"],
            "username": row.get("soundcloud_user_name"),
            "avatar_url": row.get("soundcloud_user_avatar"),
        }
    res = _request(account_id, "/me", timeout_seconds=timeout_seconds)
    if not res or not res.ok:
        return None
    profile = res.json()
    _db.update(
        "soundcloud_accounts",
        data={
            "soundcloud_user_id": str(profile.get("id") or ""),
            "soundcloud_user_name": profile.get("username") or profile.get("full_name"),
            "soundcloud_user_avatar": profile.get("avatar_url"),
        },
        where={"account_id": account_id},
    )
    return profile


def _track_metadata(track: dict) -> dict:
    user = track.get("user") or {}
    duration_ms = track.get("duration")
    created_at = str(track.get("created_at") or "")
    return {
        "title": track.get("title"),
        "artist": user.get("username") or track.get("publisher_metadata", {}).get("artist"),
        "album": track.get("publisher_metadata", {}).get("album_title"),
        "album_artist": user.get("username") or track.get("publisher_metadata", {}).get("artist"),
        "year": created_at[:4] or None,
        "track": None,
        "duration": duration_ms / 1000.0 if duration_ms is not None else None,
        "album_art": _first_artwork(track),
        "explicit": bool(track.get("publisher_metadata", {}).get("explicit", False)),
        "genre": track.get("genre"),
        "filename": None,
    }


def _is_soundcloud_url(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    hostname = (parsed.hostname or "").lower()
    return parsed.scheme in {"http", "https"} and (
        hostname == "soundcloud.com" or hostname.endswith(".soundcloud.com")
    )


def _public_url_metadata(url: str, timeout_seconds: int = 10) -> dict:
    try:
        res = http_requests.get(
            _oembed_base(),
            params={"format": "json", "url": url},
            timeout=timeout_seconds,
        )
    except http_requests.RequestException as error:
        log(f"SoundCloud oEmbed metadata request failed: {error}", "warning")
        return {}

    if not res.ok:
        return {}

    data = res.json()
    return {
        "title": data.get("title"),
        "artist": data.get("author_name"),
        "album": None,
        "album_artist": data.get("author_name"),
        "year": None,
        "track": None,
        "duration": None,
        "album_art": data.get("thumbnail_url"),
        "explicit": False,
        "genre": None,
        "filename": None,
    }


def get_metadata(user_id: int, song_id: str, timeout_seconds: int = 10) -> dict:
    if _is_soundcloud_url(song_id):
        return _public_url_metadata(song_id, timeout_seconds)
    res = _request(user_id, f"/tracks/{song_id}", timeout_seconds=timeout_seconds)
    return _track_metadata(res.json()) if res and res.ok else {}


expose(PLUGIN_KEY, "get_metadata", get_metadata)


def get_playlists(
    user_id: int,
    limit: int = 10,
    offset: int = 0,
    force_refresh: bool = False,
    timeout_seconds: int = 10,
) -> list[dict] | None:
    cache_key = (user_id, limit, offset)
    if not force_refresh:
        with _playlist_cache_lock:
            cached = _playlist_cache.get(cache_key)
            if cached and time.monotonic() - cached[0] < int(_config("cache.playlist_ttl_seconds", 30)):
                return cached[1][:limit]

    page_url = "/me/playlists"
    params = {"limit": min(max(limit, 1), 50), "linked_partitioning": "1"}
    playlists = []
    skipped = 0

    while page_url and len(playlists) < limit:
        res = _request(user_id, page_url, params=params, timeout_seconds=timeout_seconds)
        if not res or not res.ok:
            return None
        payload = res.json()
        items = payload.get("collection") if isinstance(payload, dict) else payload
        if not isinstance(items, list):
            return None
        for item in items:
            if skipped < offset:
                skipped += 1
                continue
            playlists.append(item)
            if len(playlists) >= limit:
                break
        next_href = payload.get("next_href") if isinstance(payload, dict) else None
        page_url = next_href or None
        params = None

    with _playlist_cache_lock:
        _playlist_cache[cache_key] = (time.monotonic(), playlists)
    return playlists


expose(PLUGIN_KEY, "get_playlists", get_playlists)


def get_playlist(user_id: int, playlist_id: str, include_songs: bool = False, timeout_seconds: int = 10) -> dict | None:
    res = _request(user_id, f"/playlists/{playlist_id}", timeout_seconds=timeout_seconds)
    if not res or not res.ok:
        return None
    playlist = res.json()
    if not include_songs:
        playlist.pop("tracks", None)
    playlist["_connected_user"] = _user_profile(user_id, timeout_seconds)
    return playlist


expose(PLUGIN_KEY, "get_playlist", get_playlist)


def iter_playlist_songs(
    user_id: int,
    playlist_id: str,
    page_size: int = 50,
    max_pages: int = 100,
    request_delay_ms: int = 250,
    timeout_seconds: int = 10,
    local_user_id: int | None = None,
    local_user_name: str | None = None,
    local_user_picture: str | None = None,
):
    playlist = get_playlist(user_id, playlist_id, include_songs=True, timeout_seconds=timeout_seconds)
    if not playlist:
        raise RuntimeError("SoundCloud playlist is unavailable")

    connected_user = playlist.get("_connected_user") or _user_profile(user_id, timeout_seconds) or {}
    connected_id = str(connected_user.get("id") or "")
    position = 0
    tracks = playlist.get("tracks") or []
    for raw_track in tracks[: max(1, max_pages) * max(1, page_size)]:
        track_id = raw_track.get("id")
        if not track_id:
            continue
        user = raw_track.get("user") or {}
        owner_id = str(user.get("id") or "")
        added_by = {
            "added_by": None,
            "added_by_name": user.get("username"),
            "added_by_picture": user.get("avatar_url"),
        }
        if local_user_id is not None and owner_id and owner_id == connected_id:
            added_by = {
                "added_by": local_user_id,
                "added_by_name": local_user_name or connected_user.get("username"),
                "added_by_picture": local_user_picture or connected_user.get("avatar_url"),
            }
        yield {
            "source_type": "soundcloud",
            "song_id": str(track_id),
            "path": None,
            "position": position,
            "added_at": raw_track.get("created_at"),
            **added_by,
            "soundcloud_url": raw_track.get("permalink_url"),
            "metadata": _track_metadata(raw_track),
        }
        position += 1


expose(PLUGIN_KEY, "iter_playlist_songs", iter_playlist_songs)


class SetupRequest(BaseModel):
    client_id: str
    client_secret: str


class TrackRequest(BaseModel):
    song_id: str


@api.post("/soundcloud/setup")
def setup_client(body: SetupRequest, request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    with _access_token_cache_lock:
        _access_token_cache.pop(account_id, None)
    existing = _get_row(account_id)
    data = {
        "client_id": body.client_id,
        "client_secret": body.client_secret,
        "access_token": None,
        "refresh_token": None,
        "token_expiry": None,
        "soundcloud_user_id": None,
        "soundcloud_user_name": None,
        "soundcloud_user_avatar": None,
    }
    if existing:
        _db.update("soundcloud_accounts", data=data, where={"account_id": account_id})
    else:
        _db.insert("soundcloud_accounts", {"account_id": account_id, **data})
    return {"ok": True}


@api.get("/soundcloud/status")
def status(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    row = _get_row(account_id)
    if not row:
        return {"connected": False, "client_id_set": False}
    return {
        "connected": bool(row.get("access_token") and row.get("refresh_token")),
        "client_id_set": True,
        "client_id": row["client_id"],
    }


@api.get("/soundcloud/auth/start")
def auth_start(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    row = _get_row(account_id)
    if not row or not row.get("client_id"):
        raise HTTPException(status_code=400, detail="SoundCloud app credentials are not configured for this account")

    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)
    frontend_origin = request.headers.get("origin", "").rstrip("/")
    _pkce_store[state] = {
        "verifier": verifier,
        "account_id": account_id,
        "client_id": row["client_id"],
        "client_secret": row["client_secret"],
        "expires": time.time() + max(60, int(_config("oauth.state_ttl_seconds", 600))),
        "frontend_origin": frontend_origin,
    }

    redirect_uri = _base_url(request) + "/api/plugin/soundcloud/callback"
    query = urlencode({
        "client_id": row["client_id"],
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "code_challenge_method": "S256",
        "code_challenge": challenge,
        "state": state,
    })
    return {"url": f"{_auth_base()}/authorize?{query}"}


@api.get("/soundcloud/callback")
def auth_callback(code: str, state: str, request: Request):
    entry = _pkce_store.pop(state, None)
    if not entry or time.time() > entry["expires"]:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    redirect_uri = _base_url(request) + "/api/plugin/soundcloud/callback"
    try:
        res = _token_request({
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "client_id": entry["client_id"],
            "client_secret": entry["client_secret"],
            "code_verifier": entry["verifier"],
        })
    except http_requests.RequestException:
        raise HTTPException(status_code=502, detail="Token exchange failed")

    if not res.ok:
        raise HTTPException(status_code=502, detail="Token exchange failed")

    data = res.json()
    expiry = int(time.time() * 1000) + int(data.get("expires_in", 3600)) * 1000
    existing = _get_row(entry["account_id"])
    if not existing:
        raise HTTPException(status_code=400, detail="Account setup not found; please save your SoundCloud app credentials first")

    _db.update(
        "soundcloud_accounts",
        data={
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token", existing.get("refresh_token")),
            "token_expiry": expiry,
        },
        where={"account_id": entry["account_id"]},
    )
    with _access_token_cache_lock:
        _access_token_cache[entry["account_id"]] = (data["access_token"], expiry)

    frontend_origin = entry.get("frontend_origin") or _base_url(request)
    return RedirectResponse(url=frontend_origin + "/?soundcloud_connected=1")


def _resolve_track(track_id: str, request: Request):
    if _is_soundcloud_url(track_id):
        return {
            "id": track_id,
            "url": track_id,
            "metadata": _public_url_metadata(track_id, _timeout()),
            "requires_connection": False,
        }

    account_id = get_token_user(_account_token(request))
    res = _request(account_id, f"/tracks/{track_id}")
    if not res or not res.ok:
        raise HTTPException(
            status_code=404,
            detail="SoundCloud track not found. Public SoundCloud URLs can play without connecting; numeric track IDs require SoundCloud login.",
        )
    data = res.json()
    return {
        "id": str(data.get("id") or track_id),
        "url": data.get("permalink_url") or f"{_api_base()}/tracks/{track_id}",
        "metadata": _track_metadata(data),
        "requires_connection": True,
    }


@api.post("/soundcloud/track")
def track(body: TrackRequest, request: Request, auth=Depends(verify_auth)):
    return _resolve_track(body.song_id, request)


@api.get("/soundcloud/track/{track_id}")
def track_by_id(track_id: str, request: Request, auth=Depends(verify_auth)):
    return _resolve_track(track_id, request)


@api.delete("/soundcloud/disconnect")
def disconnect(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    with _access_token_cache_lock:
        _access_token_cache.pop(account_id, None)
    with _playlist_cache_lock:
        for cache_key in [key for key in _playlist_cache if key[0] == account_id]:
            _playlist_cache.pop(cache_key, None)
    _db.update(
        "soundcloud_accounts",
        data={
            "access_token": None,
            "refresh_token": None,
            "token_expiry": None,
            "soundcloud_user_id": None,
            "soundcloud_user_name": None,
            "soundcloud_user_avatar": None,
        },
        where={"account_id": account_id},
    )
    return {"ok": True}
