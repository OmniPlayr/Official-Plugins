from fastapi import Depends, HTTPException, Query, Request
from api.helpers.plugins import api
from api.helpers.server import verify_auth, get_token_user
from api.helpers.admin import get_admin_status
from api.helpers.plugin_db import request_db_access
from pydantic import BaseModel
from .artist import get_artist_info, set_db as set_artist_db
from .album import get_album_info
from .exists import check_artist_exists

PLUGIN_KEY = "artists@built-in"
_db = None


class TokenRequest(BaseModel):
    token: str
    all_accounts: bool = False


def _account_token(request: Request) -> str:
    return request.headers.get("X-Account-Token", "") or ""


def _account_id(request: Request) -> int:
    account_id = get_token_user(_account_token(request))
    if account_id is None:
        raise HTTPException(status_code=401, detail="Invalid account token")
    return account_id


def _require_genius_token(account_id: int) -> str:
    if _db is None:
        raise HTTPException(status_code=500, detail="Artists token storage is not ready")

    row = _db.fetch_one("artists_accounts", where={"account_id": account_id})
    token = row.get("genius_token") if row else None
    if not token:
        raise HTTPException(status_code=401, detail="No Genius token configured")
    return token


def _save_token_for_account(account_id: int, token: str) -> None:
    existing = _db.fetch_one("artists_accounts", where={"account_id": account_id})
    if existing:
        _db.update("artists_accounts", data={"genius_token": token}, where={"account_id": account_id})
    else:
        _db.insert("artists_accounts", {"account_id": account_id, "genius_token": token})


def setup():
    global _db
    _db = request_db_access(
        PLUGIN_KEY,
        own={
            "artists_accounts": {
                "account_id": "INT NOT NULL UNIQUE",
                "genius_token": "TEXT NOT NULL",
            }
        },
        read=["accounts"],
    )
    set_artist_db(_db)


@api.get("/artists/status")
def status(request: Request, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_id = _account_id(request)
    row = _db.fetch_one("artists_accounts", where={"account_id": account_id}) if _db else None
    return {"token_set": bool(row and row.get("genius_token")), "is_admin": get_admin_status(account_id)}


@api.post("/artists/setup")
def setup_token(body: TokenRequest, request: Request, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    token = body.token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token is required")
    account_id = _account_id(request)

    if body.all_accounts:
        if not get_admin_status(account_id):
            raise HTTPException(status_code=403, detail="Admin access required")
        accounts = _db.fetch("accounts", columns=["id"])
        for account in accounts:
            _save_token_for_account(account["id"], token)
        return {"ok": True, "applied_count": len(accounts)}

    _save_token_for_account(account_id, token)
    return {"ok": True, "applied_count": 1}


@api.delete("/artists/disconnect")
def disconnect(request: Request, auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    account_id = _account_id(request)
    if _db:
        _db.delete("artists_accounts", where={"account_id": account_id})
    return {"ok": True}


@api.get("/artist/{artist}")
def browse_music(
    artist: str,
    request: Request,
    no_cache: bool = Query(default=False),
    song: str | None = Query(default=None),
    album: str | None = Query(default=None),
    auth=Depends(verify_auth)
):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    genius_token = _require_genius_token(_account_id(request))
    return get_artist_info(artist, song_name=song, album_name=album, no_cache=no_cache, genius_token=genius_token)

@api.get("/album/{album}")
def browse_album(
    album: str,
    request: Request,
    artist: str = Query(...),
    song: str | None = Query(default=None),
    type: str | None = Query(default=None),
    no_cache: bool = Query(default=False),
    auth=Depends(verify_auth),
):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    genius_token = _require_genius_token(_account_id(request))
    return get_album_info(album, artist_name=artist, song_name=song, release_type=type, no_cache=no_cache, genius_token=genius_token)

@api.get("/artists/exists")
def artist_exists(
    artist: str = Query(...),
    album: str | None = Query(default=None),
    song: str | None = Query(default=None),
    no_cache: bool = Query(default=False),
    auth=Depends(verify_auth),
):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return check_artist_exists(artist, album_name=album, song_name=song, no_cache=no_cache)
