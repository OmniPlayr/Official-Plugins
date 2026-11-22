import time
from fastapi import HTTPException
from omniplayr.plugins import get_token_user

from .state import get_db

_account_summary_cache = {"expires_at": 0.0, "accounts": None}
_ACCOUNT_SUMMARY_CACHE_SECONDS = 30


def require_user(auth, x_account_token):
    if not auth or not x_account_token:
        raise HTTPException(status_code=401, detail="Unauthorized")
    token_user_id = get_token_user(x_account_token)
    if not token_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return token_user_id


def resolve_user_id(user_id: str, token_user_id: int):
    if user_id.lower() == "me":
        return token_user_id
    try:
        return int(user_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid user ID")


def account_summary_from_row(row):
    if not row:
        return None
    return {"id": row.get("id"), "name": row.get("name")}


def get_account_summary(account_id: int):
    db = get_db()
    if not db:
        return None
    row = db.fetch_one("accounts", where={"id": account_id}, columns=["id", "name"])
    return account_summary_from_row(row)


def list_account_summaries():
    db = get_db()
    if not db:
        return []

    now = time.time()
    cached = _account_summary_cache.get("accounts")
    if cached is not None and float(_account_summary_cache.get("expires_at") or 0) > now:
        return cached

    rows = db.fetch("accounts", columns=["id", "name"], order_by="id")
    accounts = [account_summary_from_row(row) for row in rows]
    accounts = [account for account in accounts if account]
    _account_summary_cache["accounts"] = accounts
    _account_summary_cache["expires_at"] = now + _ACCOUNT_SUMMARY_CACHE_SECONDS
    return accounts


def load_user(user_id: str, token_user_id: int):
    resolved_user_id = resolve_user_id(user_id, token_user_id)
    user = get_account_summary(resolved_user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return resolved_user_id, user