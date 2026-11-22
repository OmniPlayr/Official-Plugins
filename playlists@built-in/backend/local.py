from omniplayr.plugins import get_account, get_plugin, log

from .accounts import get_account_summary, list_account_summaries
from .events import stream_event
from .state import get_db


def create_liked_playlist(user_id: int):
    db = get_db()
    log(f"Creating liked playlist for user_id={user_id}", "debug")
    user = get_account_summary(user_id)
    if not user:
        log(f"User id={user_id} not found", "debug")
        return

    has_liked = db.fetch_one("playlists", where={"owner_id": user_id, "is_liked_playlist": True})
    if has_liked:
        log(f"User id={user_id} already has a liked playlist", "debug")
        return

    liked_playlist = db.insert("playlists", {
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

def create_new_playlist(user_id: int):
    db = get_db()
    playlist_count = db.count("playlists", where={"owner_id": user_id, "is_liked_playlist": False})

    playlist_name = f"New Playlist #{playlist_count + 1}"
    
    new_playlist = db.insert("playlists", {
        "name": playlist_name,
        "description": "",
        "private": False,
        "owner_id": user_id,
        "is_liked_playlist": False,
        "created_by": user_id,
    })
    if not new_playlist:
        log(f"Failed to create new playlist for user_id={user_id}", "debug")
        return {
            "message": "Failed to create new playlist"
        }

    log(f"Created new playlist for user_id={user_id}", "debug")
    new_playlist["service"] = "local"
    return {
        "message": "Playlist created successfully",
        "playlist": new_playlist
    }
    

def list_playlists(user_id: int, include_private: bool = False):
    db = get_db()
    if include_private:
        return db.fetch("playlists", where={"owner_id": user_id})
    return db.fetch("playlists", where={"owner_id": user_id, "private": False})


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
        rows = get_db().fetch("playlist_collaborators", where={"playlist_id": playlist.get("id")})
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


def get_local_playlist_summaries(user_id: int, token_user_id: int, include_private: bool, limit: int | None = None, offset: int = 0):
    create_liked_playlist(user_id)
    local_playlists = list_playlists(user_id, include_private)
    local_playlists = local_playlists[offset:offset + limit] if limit is not None else local_playlists[offset:]
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


def local_playlist_songs(playlist_id: int, account_id: int):
    rows = get_db().fetch("playlist_songs", where={"playlist_id": playlist_id}, order_by="position")
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

        yield {
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
        }


def local_playlist_song_events(playlist_id: int, account_id: int):
    for song in local_playlist_songs(playlist_id, account_id):
        yield stream_event("song", song=song, cached=False)