import secrets
import hashlib
import base64
import time
import requests as http_requests
from threading import RLock
from fastapi import Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from api.helpers.plugins import api, expose
from api.helpers.log import log
from api.helpers.server import verify_auth, get_token_user
from urllib.parse import urlparse

_db = None
_pkce_store: dict[str, dict] = {}
_playlist_cache: dict[tuple[int, int, int], tuple[float, list[dict]]] = {}
_playlist_cache_lock = RLock()
_playlist_cache_ttl = 30
_access_token_cache: dict[int, tuple[str, int]] = {}
_access_token_cache_lock = RLock()


def init(db) -> None:
    global _db
    _db = db


def _account_token(request: Request) -> str:
    return request.headers.get("X-Account-Token", "") or ""


def _get_row(account_id: int) -> dict | None:
    return _db.fetch_one("spotify_accounts", where={"account_id": account_id})

def _base_url(request: Request) -> str:
    parsed = urlparse(str(request.base_url).rstrip("/"))

    is_local = parsed.hostname in ("localhost", "127.0.0.1")

    scheme = "http" if is_local else "https"

    url = f"{scheme}://{parsed.netloc}"
    if parsed.path:
        url += parsed.path

    return url

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

    res = http_requests.post("https://accounts.spotify.com/api/token", data={
        "grant_type": "refresh_token",
        "refresh_token": row["refresh_token"],
        "client_id": row["client_id"],
    })

    if not res.ok:
        return None

    data = res.json()
    expiry = now_ms + data["expires_in"] * 1000

    _db.update(
        "spotify_accounts",
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


def get_spotify_profile(account_id: int, timeout_seconds: int = 10) -> dict | None:
    row = _get_row(account_id)
    if row and row.get("spotify_user_id"):
        return {
            "id": row["spotify_user_id"],
            "display_name": row.get("spotify_user_name"),
            "images": ([{"url": row["spotify_user_avatar"]}] if row.get("spotify_user_avatar") else []),
        }

    token = get_access_token(account_id)
    if not token:
        return None
    try:
        res = http_requests.get(
            "https://api.spotify.com/v1/me",
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout_seconds,
        )
    except http_requests.RequestException:
        return None
    if not res.ok:
        return None

    profile = res.json()
    images = profile.get("images") or []
    avatar = images[0].get("url") if images else None
    _db.update(
        "spotify_accounts",
        data={
            "spotify_user_id": profile.get("id"),
            "spotify_user_name": profile.get("display_name"),
            "spotify_user_avatar": avatar,
        },
        where={"account_id": account_id},
    )
    return profile


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
            if cached and time.monotonic() - cached[0] < _playlist_cache_ttl:
                return cached[1]

    token = get_access_token(user_id)

    if not token:
        return None

    while True:
        try:
            res = http_requests.get(
                f"https://api.spotify.com/v1/me/playlists?limit={limit}&offset={offset}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=timeout_seconds,
            )
        except http_requests.RequestException:
            return None

        if res.status_code != 429:
            break

        try:
            retry_after = max(1, int(float(res.headers.get("Retry-After", "1"))))
        except ValueError:
            retry_after = 1
        log(f"Spotify playlist request rate limited; retrying in {retry_after}s", "warning")
        time.sleep(retry_after)

    if not res.ok:
        return None

    page = res.json()
    playlists = page.get("items", [])
    log(
        f"Spotify playlists page: offset={offset} limit={limit} "
        f"count={len(playlists)} total={page.get('total')} has_next={bool(page.get('next'))}",
        "debug",
    )
    with _playlist_cache_lock:
        _playlist_cache[cache_key] = (time.monotonic(), playlists)
    return playlists

expose("spotify@built-in", "get_playlists", get_playlists)


def get_playlist(
    user_id: int,
    playlist_id: str,
    include_songs: bool = False,
    timeout_seconds: int = 10,
) -> dict | None:
    token = get_access_token(user_id)
    if not token:
        return None

    try:
        res = http_requests.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}",
            headers={"Authorization": f"Bearer {token}"},
            params=None if include_songs else {
                "fields": "id,name,description,public,collaborative,images,owner(id,display_name)"
            },
            timeout=timeout_seconds,
        )
    except http_requests.RequestException:
        return None

    if not res.ok:
        return None

    playlist = res.json()
    connected_user = get_spotify_profile(user_id, timeout_seconds)
    owner = playlist.get("owner") or {}
    if owner.get("id") and not owner.get("images"):
        try:
            owner_res = http_requests.get(
                f"https://api.spotify.com/v1/users/{owner['id']}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=timeout_seconds,
            )
            if owner_res.ok:
                public_owner = owner_res.json()
                owner["display_name"] = public_owner.get("display_name") or owner.get("display_name")
                owner["images"] = public_owner.get("images") or []
        except http_requests.RequestException:
            pass
    playlist["owner"] = owner
    playlist["_connected_user"] = connected_user
    return playlist


expose("spotify@built-in", "get_playlist", get_playlist)


def _track_metadata(track: dict) -> dict:
    album = track.get("album") or {}
    artists = track.get("artists") or []
    images = album.get("images") or []
    album_art = images[0].get("url") if images and isinstance(images[0], dict) else None
    release_date = album.get("release_date") or ""
    duration_ms = track.get("duration_ms")
    return {
        "title": track.get("name"),
        "artist": ", ".join(a.get("name", "") for a in artists if a.get("name")) or None,
        "album": album.get("name"),
        "album_artist": ", ".join(
            a.get("name", "") for a in (album.get("artists") or []) if a.get("name")
        ) or None,
        "year": release_date[:4] or None,
        "track": str(track["track_number"]) if track.get("track_number") is not None else None,
        "duration": duration_ms / 1000.0 if duration_ms is not None else None,
        "album_art": album_art,
        "explicit": bool(track.get("explicit", False)),
    }


def get_metadata(user_id: int, song_id: str, timeout_seconds: int = 10) -> dict:
    """Return Spotify track metadata through the inter-plugin API."""
    token = get_access_token(user_id)
    if not token:
        return {}
    try:
        response = http_requests.get(
            f"https://api.spotify.com/v1/tracks/{song_id}",
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout_seconds,
        )
    except http_requests.RequestException:
        return {}
    return _track_metadata(response.json()) if response.ok else {}


expose("spotify@built-in", "get_metadata", get_metadata)


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
    """Yield normalized songs page-by-page so callers can stream them immediately."""
    token = get_access_token(user_id)
    if not token:
        raise RuntimeError("Spotify access token is unavailable")

    page_size = min(100, max(1, int(page_size)))
    max_pages = max(1, int(max_pages))
    request_delay = max(0, int(request_delay_ms)) / 1000
    offset = 0
    position = 0
    connected_user = get_spotify_profile(user_id, timeout_seconds) or {}
    connected_spotify_id = connected_user.get("id")
    contributor_cache: dict[str, dict] = {}

    def contributor(spotify_user: dict) -> dict:
        spotify_user_id = spotify_user.get("id")
        if not spotify_user_id:
            return {"added_by": None, "added_by_name": None, "added_by_picture": None}

        if local_user_id is not None and spotify_user_id == connected_spotify_id:
            images = connected_user.get("images") or []
            spotify_picture = images[0].get("url") if images and isinstance(images[0], dict) else None
            return {
                "added_by": local_user_id,
                "added_by_name": local_user_name or connected_user.get("display_name"),
                "added_by_picture": local_user_picture or spotify_picture,
            }

        cached = contributor_cache.get(spotify_user_id)
        if cached is not None:
            return cached

        profile = spotify_user
        try:
            profile_response = http_requests.get(
                f"https://api.spotify.com/v1/users/{spotify_user_id}",
                headers={"Authorization": f"Bearer {token}"},
                timeout=timeout_seconds,
            )
            if profile_response.ok:
                profile = profile_response.json()
        except http_requests.RequestException:
            pass

        images = profile.get("images") or []
        picture = images[0].get("url") if images and isinstance(images[0], dict) else None
        resolved = {
            "added_by": None,
            "added_by_name": profile.get("display_name") or spotify_user.get("display_name"),
            "added_by_picture": picture,
        }
        contributor_cache[spotify_user_id] = resolved
        return resolved

    for _ in range(max_pages):
        while True:
            try:
                response = http_requests.get(
                    f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
                    headers={"Authorization": f"Bearer {token}"},
                    params={"limit": page_size, "offset": offset},
                    timeout=timeout_seconds,
                )
            except http_requests.RequestException as error:
                log(f"Spotify playlist tracks request failed: {error}", "warning")
                raise RuntimeError("Spotify playlist tracks request failed") from error

            if response.status_code != 429:
                break
            try:
                retry_after = max(1, int(float(response.headers.get("Retry-After", "1"))))
            except ValueError:
                retry_after = 1
            log(f"Spotify playlist tracks request rate limited; retrying in {retry_after}s", "warning")
            time.sleep(retry_after)

        if not response.ok:
            log(
                f"Spotify playlist tracks request failed: status={response.status_code} "
                f"playlist={playlist_id!r} offset={offset}",
                "warning",
            )
            raise RuntimeError(f"Spotify playlist tracks request failed with status {response.status_code}")

        page = response.json()
        items = page.get("items") or []
        for item in items:
            track = (item or {}).get("track") or {}
            song_id = track.get("id")
            if not song_id or track.get("type") != "track":
                continue
            added_by = contributor((item or {}).get("added_by") or {})
            yield {
                "source_type": "spotify",
                "song_id": song_id,
                "path": None,
                "position": position,
                "added_at": (item or {}).get("added_at"),
                **added_by,
                "spotify_uri": track.get("uri"),
                "metadata": _track_metadata(track),
            }
            position += 1

        if not page.get("next") or not items:
            break
        offset += len(items)
        if request_delay:
            time.sleep(request_delay)


expose("spotify@built-in", "iter_playlist_songs", iter_playlist_songs)

class SetupRequest(BaseModel):
    client_id: str


class RefreshRequest(BaseModel):
    refresh_token: str


@api.post("/spotify/setup")
def setup_client(body: SetupRequest, request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    with _access_token_cache_lock:
        _access_token_cache.pop(account_id, None)
    existing = _get_row(account_id)

    if existing:
        _db.update(
            "spotify_accounts",
            data={
                "client_id": body.client_id,
                "access_token": None,
                "refresh_token": None,
                "token_expiry": None,
                "spotify_user_id": None,
                "spotify_user_name": None,
                "spotify_user_avatar": None,
            },
            where={"account_id": account_id},
        )
    else:
        _db.insert("spotify_accounts", {"account_id": account_id, "client_id": body.client_id})

    return {"ok": True}


@api.get("/spotify/status")
def status(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    row = _get_row(account_id)

    if not row:
        return {"connected": False, "client_id_set": False}

    connected = bool(row.get("access_token") and row.get("refresh_token"))
    return {"connected": connected, "client_id_set": True, "client_id": row["client_id"]}


@api.get("/spotify/auth/start")
def auth_start(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    row = _get_row(account_id)

    if not row or not row.get("client_id"):
        raise HTTPException(status_code=400, detail="Client ID not configured for this account")

    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    state = secrets.token_urlsafe(16)

    frontend_origin = request.headers.get("origin", "").rstrip("/")

    _pkce_store[state] = {
        "verifier": verifier,
        "account_id": account_id,
        "client_id": row["client_id"],
        "expires": time.time() + 600,
        "frontend_origin": frontend_origin,
    }

    redirect_uri = _base_url(request) + "/api/plugin/spotify/callback"

    params = "&".join([
        f"client_id={row['client_id']}",
        "response_type=code",
        f"redirect_uri={redirect_uri}",
        "code_challenge_method=S256",
        f"code_challenge={challenge}",
        f"state={state}",
        "scope=streaming%20user-read-email%20user-read-private%20playlist-read-private%20playlist-read-collaborative",
    ])

    return {"url": f"https://accounts.spotify.com/authorize?{params}"}


@api.get("/spotify/callback")
def auth_callback(code: str, state: str, request: Request):
    entry = _pkce_store.pop(state, None)

    if not entry or time.time() > entry["expires"]:
        raise HTTPException(status_code=400, detail="Invalid or expired state")

    redirect_uri = _base_url(request) + "/api/plugin/spotify/callback"

    res = http_requests.post("https://accounts.spotify.com/api/token", data={
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": redirect_uri,
        "client_id": entry["client_id"],
        "code_verifier": entry["verifier"],
    })

    if not res.ok:
        raise HTTPException(status_code=502, detail="Token exchange failed")

    data = res.json()
    expiry = int(time.time() * 1000) + data["expires_in"] * 1000

    existing = _get_row(entry["account_id"])

    if not existing:
        raise HTTPException(status_code=400, detail="Account setup not found; please save your Client ID first")

    _db.update(
        "spotify_accounts",
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
    return RedirectResponse(url=frontend_origin + "/?spotify_connected=1")


@api.get("/spotify/token")
def get_token(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    token = get_access_token(account_id)

    if not token:
        raise HTTPException(status_code=401, detail="Not connected to Spotify")

    return {"access_token": token}


@api.delete("/spotify/disconnect")
def disconnect(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))

    with _access_token_cache_lock:
        _access_token_cache.pop(account_id, None)

    with _playlist_cache_lock:
        for cache_key in [key for key in _playlist_cache if key[0] == account_id]:
            _playlist_cache.pop(cache_key, None)

    _db.update(
        "spotify_accounts",
        data={
            "access_token": None,
            "refresh_token": None,
            "token_expiry": None,
            "spotify_user_id": None,
            "spotify_user_name": None,
            "spotify_user_avatar": None,
        },
        where={"account_id": account_id},
    )

    return {"ok": True}
