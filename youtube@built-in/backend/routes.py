import json
import re
import time
from pathlib import Path
from threading import RLock

import requests as http_requests
from fastapi import Depends, HTTPException, Request
from pydantic import BaseModel
from ytmusicapi import OAuthCredentials, YTMusic

from omniplayr.plugins import api, expose, get_plugin_config, get_token_user, log, verify_auth
from .metadata import get_artwork

PLUGIN_KEY = "youtube@built-in"
YOUTUBE_SCOPE = "https://www.googleapis.com/auth/youtube"
YOUTUBE_DATA_API = "https://www.googleapis.com/youtube/v3"

_db = None
_device_flow_store: dict[str, dict] = {}
_playlist_cache: dict[int, tuple[float, list[dict]]] = {}
_playlist_cache_lock = RLock()
_ytmusic_cache: dict[int, tuple[YTMusic, int]] = {}
_ytmusic_cache_lock = RLock()


def init(db) -> None:
    global _db
    _db = db


def _config(key, default=None):
    return get_plugin_config(PLUGIN_KEY, key, default=default)


def _account_token(request: Request) -> str:
    return request.headers.get("X-Account-Token", "") or ""


def _get_row(account_id: int) -> dict | None:
    return _db.fetch_one("youtube_accounts", where={"account_id": account_id})


def _thumbnail_url(thumbnails) -> str | None:
    if not isinstance(thumbnails, list) or not thumbnails:
        return None
    thumbnail = thumbnails[-1]
    return thumbnail.get("url") if isinstance(thumbnail, dict) else None


def _safe_file_part(value) -> str:
    return "".join(character for character in str(value) if character.isalnum() or character in "-_") or "unknown"


def _oauth_cache_dir() -> Path:
    configured = Path(str(_config("oauth.cache_dir", "user_storage/youtube-oauth")))
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


def _oauth_file_path(account_id: int) -> Path:
    return _oauth_cache_dir() / f"account-{_safe_file_part(account_id)}.oauth.json"


def _oauth_payload(row: dict) -> dict:
    now = int(time.time())
    expiry_ms = int(row.get("token_expiry") or 0)
    return {
        "scope": YOUTUBE_SCOPE,
        "token_type": "Bearer",
        "access_token": row.get("access_token"),
        "refresh_token": row.get("refresh_token"),
        "expires_in": max(0, int((expiry_ms / 1000) - now)),
        "expires_at": int(expiry_ms / 1000) if expiry_ms else now,
    }


def _write_oauth_file(account_id: int, row: dict) -> Path | None:
    path = _oauth_file_path(account_id)
    try:
        path.write_text(json.dumps(_oauth_payload(row), indent=2), encoding="utf-8")
        try:
            path.chmod(0o600)
        except OSError:
            pass
        log(f"YouTube Music wrote oauth token file for account {account_id}: {path}", "debug")
        return path
    except Exception as error:
        log(
            f"YouTube Music could not write oauth token file for account {account_id}: "
            f"{type(error).__name__}: {error}",
            "debug",
        )
        return None


def _sync_oauth_file_to_db(account_id: int, path: Path | None) -> None:
    if not path or not path.exists():
        return
    try:
        token = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        log(
            f"YouTube Music could not read oauth token file for account {account_id}: "
            f"{type(error).__name__}: {error}",
            "debug",
        )
        return

    expires_at = int(token.get("expires_at") or 0)
    expires_in = int(token.get("expires_in") or 0)
    token_expiry = expires_at * 1000 if expires_at else int(time.time() * 1000) + expires_in * 1000
    data = {
        "access_token": token.get("access_token"),
        "refresh_token": token.get("refresh_token"),
        "token_expiry": token_expiry,
    }
    try:
        _db.update("youtube_accounts", data=data, where={"account_id": account_id})
        log(f"YouTube Music synced oauth token file back to DB for account {account_id}", "debug")
    except Exception as error:
        log(
            f"YouTube Music could not sync oauth token file to DB for account {account_id}: "
            f"{type(error).__name__}: {error}",
            "debug",
        )


def _refresh_access_token(account_id: int, row: dict) -> str | None:
    now_ms = int(time.time() * 1000)
    expiry = int(row.get("token_expiry") or 0)
    if row.get("access_token") and expiry and now_ms < expiry - 60_000:
        return row["access_token"]
    if not row.get("refresh_token") or not row.get("client_id") or not row.get("client_secret"):
        log(f"YouTube Data API token refresh skipped for account {account_id}: OAuth data is incomplete", "debug")
        return row.get("access_token")

    try:
        response = http_requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": row["client_id"],
                "client_secret": row["client_secret"],
                "grant_type": "refresh_token",
                "refresh_token": row["refresh_token"],
            },
            timeout=15,
        )
    except http_requests.RequestException as error:
        log(f"YouTube Data API token refresh failed for account {account_id}: {error}", "debug")
        return row.get("access_token")

    if not response.ok:
        log(
            f"YouTube Data API token refresh failed for account {account_id}: "
            f"status={response.status_code} body={response.text[:500]}",
            "debug",
        )
        return row.get("access_token")

    data = response.json()
    token_expiry = now_ms + int(data.get("expires_in", 3600)) * 1000
    updated = {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token", row.get("refresh_token")),
        "token_expiry": token_expiry,
    }
    _db.update("youtube_accounts", data=updated, where={"account_id": account_id})
    row.update(updated)
    _write_oauth_file(account_id, row)
    log(f"YouTube Data API refreshed access token for account {account_id}", "debug")
    return row.get("access_token")


def _youtube_api_get(account_id: int, endpoint: str, params: dict, timeout_seconds: int = 10) -> dict | None:
    row = _get_row(account_id)
    if not row or not row.get("refresh_token"):
        log(f"YouTube Data API request skipped for account {account_id}: account is not connected", "debug")
        return None

    access_token = _refresh_access_token(account_id, row)
    if not access_token:
        log(f"YouTube Data API request skipped for account {account_id}: no access token", "debug")
        return None

    url = f"{YOUTUBE_DATA_API}/{endpoint.lstrip('/')}"
    try:
        response = http_requests.get(
            url,
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=timeout_seconds,
        )
    except http_requests.RequestException as error:
        log(f"YouTube Data API request failed for account {account_id}: {endpoint}: {error}", "debug")
        return None

    if not response.ok:
        log(
            f"YouTube Data API request failed for account {account_id}: {endpoint}: "
            f"status={response.status_code} body={response.text[:500]}",
            "debug",
        )
        return None

    return response.json()


def _api_thumbnail(thumbnails: dict | None) -> str | None:
    if not isinstance(thumbnails, dict):
        return None
    for key in ("maxres", "standard", "high", "medium", "default"):
        image = thumbnails.get(key)
        if isinstance(image, dict) and image.get("url"):
            return image["url"]
    return None


def _api_playlist(item: dict, connected_user: dict | None = None) -> dict:
    snippet = item.get("snippet") or {}
    status = item.get("status") or {}
    thumbnail = _api_thumbnail(snippet.get("thumbnails"))
    return {
        "id": item.get("id"),
        "playlistId": item.get("id"),
        "title": snippet.get("title") or "Unknown Playlist",
        "description": snippet.get("description"),
        "privacy": str(status.get("privacyStatus") or "").upper(),
        "thumbnails": [{"url": thumbnail}] if thumbnail else [],
        "author": {
            "id": snippet.get("channelId"),
            "name": snippet.get("channelTitle"),
        },
        "_connected_user": connected_user or {},
    }


def _iso_duration_seconds(value: str | None) -> int | None:
    match = re.fullmatch(r"P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", str(value or ""))
    if not match:
        return None
    days, hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def _api_playlist_items(
    account_id: int,
    playlist_id: str,
    limit: int,
    timeout_seconds: int = 10,
) -> list[dict] | None:
    tracks = []
    page_token = None
    max_tracks = max(1, limit)
    while len(tracks) < max_tracks:
        params = {
            "part": "snippet,contentDetails,status",
            "playlistId": playlist_id,
            "maxResults": min(50, max_tracks - len(tracks)),
        }
        if page_token:
            params["pageToken"] = page_token
        data = _youtube_api_get(account_id, "playlistItems", params, timeout_seconds)
        if data is None:
            return None
        playlist_items = data.get("items") or []
        ordered_ids = []
        for item in playlist_items:
            snippet = item.get("snippet") or {}
            content = item.get("contentDetails") or {}
            video_id = content.get("videoId") or snippet.get("resourceId", {}).get("videoId")
            if video_id:
                ordered_ids.append(video_id)

        videos = {}
        if ordered_ids:
            video_data = _youtube_api_get(
                account_id,
                "videos",
                {
                    "part": "snippet,contentDetails,status",
                    "id": ",".join(ordered_ids),
                    "maxResults": len(ordered_ids),
                },
                timeout_seconds,
            )
            if video_data is None:
                return None
            videos = {item.get("id"): item for item in video_data.get("items") or [] if item.get("id")}

        for video_id in ordered_ids:
            video = videos.get(video_id)
            if not video:
                continue
            snippet = video.get("snippet") or {}
            content = video.get("contentDetails") or {}
            status = video.get("status") or {}
            if status.get("uploadStatus") not in {None, "processed"}:
                continue
            if status.get("privacyStatus") not in {"public", "unlisted"}:
                continue
            thumbnail = _api_thumbnail(snippet.get("thumbnails"))
            tracks.append({
                "videoId": video_id,
                "title": snippet.get("title"),
                "artists": [{"name": snippet.get("channelTitle")}],
                "album": {},
                "duration_seconds": _iso_duration_seconds(content.get("duration")),
                "thumbnails": [{"url": thumbnail}] if thumbnail else [],
                "year": (snippet.get("publishedAt") or "")[:4] or None,
                "isAvailable": True,
            })
            if len(tracks) >= max_tracks:
                break
        page_token = data.get("nextPageToken")
        if not page_token:
            break
    return tracks


def _connected_user_from_api(account_id: int, timeout_seconds: int = 10) -> dict:
    row = _get_row(account_id) or {}
    if row.get("youtube_user_name") or row.get("youtube_user_id"):
        return {
            "id": row.get("youtube_user_id"),
            "name": row.get("youtube_user_name"),
            "avatar": row.get("youtube_user_avatar"),
        }

    data = _youtube_api_get(
        account_id,
        "channels",
        {"part": "snippet", "mine": "true", "maxResults": 1},
        timeout_seconds,
    )
    item = (data.get("items") or [{}])[0] if isinstance(data, dict) else {}
    snippet = item.get("snippet") or {}
    user_id = item.get("id")
    name = snippet.get("title")
    avatar = _api_thumbnail(snippet.get("thumbnails"))
    if user_id or name or avatar:
        _db.update(
            "youtube_accounts",
            data={
                "youtube_user_id": user_id,
                "youtube_user_name": name,
                "youtube_user_avatar": avatar,
            },
            where={"account_id": account_id},
        )
    return {"id": user_id, "name": name, "avatar": avatar}


def _ytmusic(account_id: int) -> YTMusic | None:
    now_ms = int(time.time() * 1000)
    with _ytmusic_cache_lock:
        cached = _ytmusic_cache.get(account_id)
        if cached and now_ms < cached[1] - 60_000:
            return cached[0]

    row = _get_row(account_id)
    if not row:
        log(f"YouTube Music account {account_id} has not been configured", "debug")
        return None
    if not row.get("client_id") or not row.get("client_secret"):
        log(f"YouTube Music account {account_id} is missing OAuth client credentials", "debug")
        return None
    if not row.get("refresh_token"):
        log(f"YouTube Music account {account_id} is not connected; refresh token is missing", "debug")
        return None

    expiry = int(row.get("token_expiry") or 0)
    log(
        f"YouTube Music account {account_id} creating client "
        f"(access_token={'yes' if row.get('access_token') else 'no'}, "
        f"refresh_token=yes, token_expiry={expiry or 'none'})",
        "debug",
    )
    oauth_file = _write_oauth_file(account_id, row)
    auth = str(oauth_file) if oauth_file else _oauth_payload(row)
    try:
        client = YTMusic(
            auth,
            oauth_credentials=OAuthCredentials(
                client_id=row["client_id"],
                client_secret=row["client_secret"],
            ),
        )
    except Exception as error:
        log(f"YouTube Music client setup failed for account {account_id}: {type(error).__name__}: {error}", "debug")
        return None

    with _ytmusic_cache_lock:
        _ytmusic_cache[account_id] = (client, expiry or now_ms + 300_000)
    _sync_oauth_file_to_db(account_id, oauth_file)
    return client


def get_auth_status(user_id: int, timeout_seconds: int = 10) -> dict:
    row = _get_row(user_id)
    if not row:
        return {"configured": False, "connected": False}
    return {
        "configured": bool(row.get("client_id") and row.get("client_secret")),
        "connected": bool(row.get("refresh_token")),
        "access_token_set": bool(row.get("access_token")),
        "token_expiry": int(row.get("token_expiry") or 0),
    }


expose(PLUGIN_KEY, "get_auth_status", get_auth_status)


def _connected_user(client: YTMusic, account_id: int) -> dict:
    row = _get_row(account_id) or {}
    if row.get("youtube_user_name") or row.get("youtube_user_id"):
        return {
            "id": row.get("youtube_user_id"),
            "name": row.get("youtube_user_name"),
            "avatar": row.get("youtube_user_avatar"),
        }

    try:
        account = client.get_account_info()
    except Exception:
        account = {}

    profile = account if isinstance(account, dict) else {}
    name = profile.get("accountName") or profile.get("channelHandle")
    user_id = profile.get("channelHandle") or name
    avatar = profile.get("accountPhotoUrl")
    _db.update(
        "youtube_accounts",
        data={
            "youtube_user_id": user_id,
            "youtube_user_name": name,
            "youtube_user_avatar": avatar,
        },
        where={"account_id": account_id},
    )
    return {"id": user_id, "name": name, "avatar": avatar}


def _track_metadata(track: dict) -> dict:
    artists = track.get("artists") or []
    album = track.get("album") or {}
    duration = track.get("duration_seconds")
    return {
        "title": track.get("title") or "Unknown Track",
        "artist": ", ".join(a.get("name", "") for a in artists if a.get("name")) or None,
        "album": album.get("name"),
        "album_artist": None,
        "year": track.get("year"),
        "track": None,
        "duration": duration,
        "album_art": get_artwork(_thumbnail_url(track.get("thumbnails"))),
        "explicit": bool(track.get("isExplicit", False)),
    }


def get_metadata(user_id: int, song_id: str, timeout_seconds: int = 10) -> dict:
    from .metadata import get_metadata as public_metadata

    client = _ytmusic(user_id) if user_id else None
    if not client:
        return public_metadata(song_id)
    try:
        song = client.get_song(song_id)
    except Exception as error:
        log(
            f"Authenticated YouTube metadata request failed for account {user_id}, "
            f"song {song_id}: {type(error).__name__}: {error}",
            "debug",
        )
        return public_metadata(song_id)
    details = song.get("videoDetails", {}) if isinstance(song, dict) else {}
    if not details.get("title"):
        return public_metadata(song_id)
    thumbnails = details.get("thumbnail", {}).get("thumbnails", [])
    return {
        "title": details.get("title"),
        "artist": details.get("author"),
        "album": None,
        "album_artist": details.get("author"),
        "year": None,
        "track": None,
        "duration": int(details["lengthSeconds"]) if details.get("lengthSeconds") else None,
        "album_art": get_artwork(_thumbnail_url(thumbnails)),
        "explicit": False,
    }


expose(PLUGIN_KEY, "get_metadata", get_metadata)


def get_playlists(
    user_id: int,
    limit: int = 10,
    offset: int = 0,
    force_refresh: bool = False,
    timeout_seconds: int = 10,
) -> list[dict] | None:
    limit = max(1, int(limit))
    offset = max(0, int(offset))
    if not force_refresh:
        with _playlist_cache_lock:
            cached = _playlist_cache.get(user_id)
            if cached and time.monotonic() - cached[0] < 60:
                return cached[1][offset:offset + limit]

    client = _ytmusic(user_id)
    if not client:
        return None
    connected_user = _connected_user_from_api(user_id, timeout_seconds)
    channel_id = connected_user.get("id")
    if not channel_id:
        log(
            f"YouTube Music playlist request failed for account {user_id}: "
            "YouTube channel ID is unavailable; verify that YouTube Data API v3 is enabled",
            "warning",
        )
        return None

    log(f"YouTube Music requesting user playlists for account {user_id}", "debug")
    try:
        user = client.get_user(channel_id)
        playlist_section = user.get("playlists") or {} if isinstance(user, dict) else {}
        params = playlist_section.get("params")
        if params:
            collected = client.get_user_playlists(channel_id, params)
        else:
            collected = playlist_section.get("results") or []
    except Exception as error:
        log(
            f"YouTube Music user playlist request failed for account {user_id}: "
            f"{type(error).__name__}: {error}",
            "warning",
        )
        return None

    playlists = []
    for item in collected or []:
        if not isinstance(item, dict):
            continue
        playlist = item.copy()
        playlist["_connected_user"] = connected_user
        if not playlist.get("author"):
            playlist["author"] = connected_user
        playlists.append(playlist)

    log(f"YouTube Music user playlist request returned {len(playlists)} playlists for account {user_id}", "debug")
    row = _get_row(user_id)
    _sync_oauth_file_to_db(user_id, _oauth_file_path(user_id) if row else None)

    with _playlist_cache_lock:
        _playlist_cache[user_id] = (time.monotonic(), playlists)
    return playlists[offset:offset + limit]


expose(PLUGIN_KEY, "get_playlists", get_playlists)


def get_playlist(user_id: int, playlist_id: str, include_songs: bool = False, timeout_seconds: int = 10) -> dict | None:
    data = _youtube_api_get(
        user_id,
        "playlists",
        {"part": "snippet,contentDetails,status", "id": playlist_id, "maxResults": 1},
        timeout_seconds,
    )
    if data is None:
        return None
    items = data.get("items") or []
    if not items:
        return None
    playlist = _api_playlist(items[0], _connected_user_from_api(user_id, timeout_seconds))
    if include_songs:
        tracks = _api_playlist_items(user_id, playlist_id, 5000, timeout_seconds)
        if tracks is None:
            return None
        playlist["tracks"] = tracks
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
        raise RuntimeError("YouTube Music playlist is unavailable")

    tracks = playlist.get("tracks") or []
    max_tracks = max(1, int(page_size)) * max(1, int(max_pages))
    for position, track in enumerate(tracks[:max_tracks]):
        song_id = track.get("videoId")
        if not song_id or track.get("isAvailable") is False:
            continue
        yield {
            "source_type": "youtube",
            "song_id": song_id,
            "path": f"https://music.youtube.com/watch?v={song_id}",
            "position": position,
            "added_at": None,
            "added_by": local_user_id,
            "added_by_name": local_user_name,
            "added_by_picture": local_user_picture,
            "spotify_uri": None,
            "youtube_url": f"https://music.youtube.com/watch?v={song_id}",
            "metadata": _track_metadata(track),
        }


expose(PLUGIN_KEY, "iter_playlist_songs", iter_playlist_songs)


class SetupRequest(BaseModel):
    client_id: str
    client_secret: str


class DevicePollRequest(BaseModel):
    flow_id: str


@api.post("/youtube/setup")
def setup_client(body: SetupRequest, request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    with _ytmusic_cache_lock:
        _ytmusic_cache.pop(account_id, None)
    with _playlist_cache_lock:
        _playlist_cache.pop(account_id, None)
    existing = _get_row(account_id)
    data = {
        "client_id": body.client_id,
        "client_secret": body.client_secret,
        "access_token": None,
        "refresh_token": None,
        "token_expiry": None,
        "youtube_user_id": None,
        "youtube_user_name": None,
        "youtube_user_avatar": None,
    }
    if existing:
        _db.update("youtube_accounts", data=data, where={"account_id": account_id})
    else:
        _db.insert("youtube_accounts", {"account_id": account_id, **data})
    return {"ok": True}


@api.get("/youtube/status")
def status(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    row = _get_row(account_id)
    if not row:
        return {"connected": False, "client_id_set": False}
    return {
        "connected": bool(row.get("refresh_token")),
        "client_id_set": True,
        "client_id": row["client_id"],
    }


@api.post("/youtube/auth/start")
def auth_start(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    row = _get_row(account_id)
    if not row or not row.get("client_id") or not row.get("client_secret"):
        raise HTTPException(status_code=400, detail="YouTube OAuth client credentials are not configured")

    try:
        response = http_requests.post(
            "https://www.youtube.com/o/oauth2/device/code",
            data={"client_id": row["client_id"], "scope": YOUTUBE_SCOPE},
            timeout=15,
        )
    except http_requests.RequestException as error:
        log(f"YouTube device auth failed to start: {error}", "warning")
        raise HTTPException(status_code=502, detail="Could not start YouTube device login")

    if not response.ok:
        raise HTTPException(status_code=502, detail="Could not start YouTube device login")

    payload = response.json()
    flow_id = payload["device_code"]
    _device_flow_store[flow_id] = {
        "account_id": account_id,
        "client_id": row["client_id"],
        "client_secret": row["client_secret"],
        "expires": time.time() + int(payload.get("expires_in", 900)),
        "interval": int(payload.get("interval", 5)),
    }
    return {
        "flow_id": flow_id,
        "user_code": payload.get("user_code"),
        "verification_url": payload.get("verification_url") or payload.get("verification_uri"),
        "verification_url_complete": payload.get("verification_url_complete") or payload.get("verification_uri_complete"),
        "expires_in": payload.get("expires_in", 900),
        "interval": payload.get("interval", 5),
    }


@api.post("/youtube/auth/poll")
def auth_poll(body: DevicePollRequest, auth=Depends(verify_auth)):
    entry = _device_flow_store.get(body.flow_id)
    if not entry or time.time() > entry["expires"]:
        _device_flow_store.pop(body.flow_id, None)
        raise HTTPException(status_code=400, detail="Invalid or expired YouTube login")

    try:
        response = http_requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": entry["client_id"],
                "client_secret": entry["client_secret"],
                "code": body.flow_id,
                "grant_type": "http://oauth.net/grant_type/device/1.0",
            },
            timeout=15,
        )
    except http_requests.RequestException as error:
        log(f"YouTube device token poll failed: {error}", "warning")
        raise HTTPException(status_code=502, detail="Could not check YouTube login")

    if response.status_code == 428 or response.status_code == 400:
        data = response.json()
        reason = data.get("error")
        if reason in {"authorization_pending", "slow_down"}:
            return {"connected": False, "pending": True, "slow_down": reason == "slow_down"}

    if not response.ok:
        raise HTTPException(status_code=502, detail="YouTube login failed")

    data = response.json()
    expiry = int(time.time() * 1000) + int(data.get("expires_in", 3600)) * 1000
    _db.update(
        "youtube_accounts",
        data={
            "access_token": data["access_token"],
            "refresh_token": data.get("refresh_token"),
            "token_expiry": expiry,
            "youtube_user_id": None,
            "youtube_user_name": None,
            "youtube_user_avatar": None,
        },
        where={"account_id": entry["account_id"]},
    )
    _device_flow_store.pop(body.flow_id, None)
    with _ytmusic_cache_lock:
        _ytmusic_cache.pop(entry["account_id"], None)
    with _playlist_cache_lock:
        _playlist_cache.pop(entry["account_id"], None)
    return {"connected": True}


@api.delete("/youtube/disconnect")
def disconnect(request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    with _ytmusic_cache_lock:
        _ytmusic_cache.pop(account_id, None)
    with _playlist_cache_lock:
        _playlist_cache.pop(account_id, None)
    _db.update(
        "youtube_accounts",
        data={
            "access_token": None,
            "refresh_token": None,
            "token_expiry": None,
            "youtube_user_id": None,
            "youtube_user_name": None,
            "youtube_user_avatar": None,
        },
        where={"account_id": account_id},
    )
    return {"ok": True}
