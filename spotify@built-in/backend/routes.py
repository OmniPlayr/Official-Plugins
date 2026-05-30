import secrets
import hashlib
import base64
import time
import requests as http_requests
from fastapi import Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from api.helpers.plugins import api
from api.helpers.server import verify_auth, get_token_user
from urllib.parse import urlparse


_db = None
_pkce_store: dict[str, dict] = {}


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
    row = _get_row(account_id)
    if not row or not row.get("refresh_token"):
        return None

    now_ms = int(time.time() * 1000)

    if row.get("access_token") and row.get("token_expiry") and now_ms < int(row["token_expiry"]) - 60_000:
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

    return data["access_token"]


class SetupRequest(BaseModel):
    client_id: str


class RefreshRequest(BaseModel):
    refresh_token: str


@api.post("/spotify/setup")
def setup_client(body: SetupRequest, request: Request, auth=Depends(verify_auth)):
    account_id = get_token_user(_account_token(request))
    existing = _get_row(account_id)

    if existing:
        _db.update(
            "spotify_accounts",
            data={"client_id": body.client_id, "access_token": None, "refresh_token": None, "token_expiry": None},
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
        "scope=streaming%20user-read-email%20user-read-private",
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

    _db.update(
        "spotify_accounts",
        data={"access_token": None, "refresh_token": None, "token_expiry": None},
        where={"account_id": account_id},
    )

    return {"ok": True}