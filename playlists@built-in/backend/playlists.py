from .state import set_db
from .local import add_playlist_collaborators, create_liked_playlist, list_playlists
from .providers import fetch_playlists, get_detail
from .routes import (
    get_cached_playlists,
    get_playlist,
    get_playlist_queue_songs,
    get_playlists,
    stream_playlist,
    stream_playlists,
)


def init(db) -> None:
    set_db(db)


def get_spotify_playlist(playlist_id: str, user_id: int):
    return get_detail("spotify", playlist_id, user_id)


def get_soundcloud_playlist(playlist_id: str, user_id: int):
    return get_detail("soundcloud", playlist_id, user_id)


def get_youtube_playlist(playlist_id: str, user_id: int):
    return get_detail("youtube", playlist_id, user_id)


def get_spotify_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return fetch_playlists("spotify", limit=limit, offset=offset, user_id=user_id, local_owner=local_owner)


def get_soundcloud_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return fetch_playlists("soundcloud", limit=limit, offset=offset, user_id=user_id, local_owner=local_owner)


def get_youtube_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return fetch_playlists("youtube", limit=limit, offset=offset, user_id=user_id, local_owner=local_owner)