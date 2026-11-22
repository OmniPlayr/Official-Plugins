from threading import Lock
from omniplayr.plugins import log

from .config import FREQUENT_LIMIT
from .state import get_db

_lock = Lock()
_TABLE = "frequent_playlists"


def get_frequent_playlists(account_id: int):
    return get_db().fetch(_TABLE, where={"account_id": account_id}, order_by="frequency")


def _sort_key(row):
    frequency = row.get("frequency")
    return (frequency if isinstance(frequency, int) else 10**9, row.get("id") or 0)


def _row_key(row):
    return (str(row.get("playlist_id")), row.get("service") or "local")


def _bump(playlist_id: str, service: str, account_id: int):
    db = get_db()
    target = (str(playlist_id), service)

    with _lock:
        rows = sorted(db.fetch(_TABLE, where={"account_id": account_id}), key=_sort_key)

        target_row = None
        others = []
        surplus = []
        seen = set()
        for row in rows:
            key = _row_key(row)
            if key == target:
                if target_row is None:
                    target_row = row
                else:
                    surplus.append(row)
            elif key in seen:
                surplus.append(row)
            else:
                seen.add(key)
                others.append(row)

        if target_row is None:
            db.insert(
                _TABLE,
                {
                    "frequency": 1,
                    "playlist_id": target[0],
                    "service": service,
                    "account_id": account_id,
                },
            )
        elif target_row.get("frequency") != 1 or target_row.get("service") != service:
            db.update(
                _TABLE,
                data={"frequency": 1, "service": service},
                where={"id": target_row["id"]},
            )

        for rank, row in enumerate(others, start=2):
            if rank > FREQUENT_LIMIT:
                surplus.append(row)
            elif row.get("frequency") != rank:
                db.update(_TABLE, data={"frequency": rank}, where={"id": row["id"]})

        for row in surplus:
            db.delete(_TABLE, where={"id": row["id"]})


def add_frequent_playlist(playlist_id, service: str, account_id: int) -> None:
    try:
        _bump(str(playlist_id), service, account_id)
    except Exception as error:
        log(f"Failed to update frequent playlists for account {account_id}: {error}", "warning")