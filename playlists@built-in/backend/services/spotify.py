from api.helpers.account import get_account
from api.helpers.plugins import call, has_function, is_installed
from api.helpers.log import log


def _first_image_url(images):
    if not isinstance(images, list):
        return None

    for image in images:
        if isinstance(image, dict) and image.get("url"):
            return image["url"]

    return None


def convert_playlist(playlist: dict, user_id: int, local_owner=None, include_profile_images=False) -> dict:
    owner = playlist.get("owner") or {}
    connected_user = playlist.get("_connected_user") or {}
    owner_is_connected_user = bool(
        owner.get("id") and connected_user.get("id") and owner["id"] == connected_user["id"]
    )

    converted = {
        "id": playlist.get("id"),
        "service": "spotify",
        "name": playlist.get("name") or "Unknown Playlist",
        "cover": _first_image_url(playlist.get("images")),
        "description": playlist.get("description") or None,
        "private": playlist.get("public") is not True,
        "owner_id": user_id,
        "is_liked_playlist": False,
        "created_by": None,
        "created_by_name": owner.get("display_name") or owner.get("id") or "Unknown User",
        "group_id": None,
    }

    if include_profile_images:
        if owner_is_connected_user and local_owner:
            creator_id = user_id
            creator_name = local_owner.get("name") or "Unknown User"
            creator_avatar = local_owner.get("avatar_b64")
            converted["created_by"] = user_id
        else:
            creator_id = f"spotify:{owner.get('id') or 'unknown'}"
            creator_name = owner.get("display_name") or owner.get("id") or "Unknown User"
            creator_avatar = _first_image_url(owner.get("images"))

        converted["created_by_name"] = creator_name
        converted["created_by_avatar"] = creator_avatar
        converted["collaborators"] = [{
            "account_id": creator_id,
            "permission": "owner",
            "name": creator_name,
            "avatar": creator_avatar,
        }]

    return converted


def refresh_detail(playlist_id: str, user_id: int, local_owner, config):
    if not is_installed("spotify@built-in") or not has_function("spotify@built-in", "get_playlist"):
        return None

    spotify_playlist = call(
        "spotify@built-in",
        "get_playlist",
        user_id=user_id,
        playlist_id=playlist_id,
        include_songs=False,
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
    )
    if not isinstance(spotify_playlist, dict):
        return None

    return convert_playlist(
        spotify_playlist,
        user_id,
        local_owner,
        include_profile_images=True,
    )


def get_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None, config=None):
    log("Getting spotify playlists", "debug")
    spotify_plugin = is_installed("spotify@built-in")
    if not spotify_plugin:
        log("Spotify plugin not installed", "debug")
        return []

    has_correct_function = has_function("spotify@built-in", "get_playlists")
    if not has_correct_function:
        log("Spotify plugin does not have get_playlists function", "debug")
        return []

    spotify_playlists = call(
        "spotify@built-in",
        "get_playlists",
        user_id=user_id,
        limit=limit,
        offset=offset,
        force_refresh=True,
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
    )
    if spotify_playlists is None:
        return None
    if local_owner is None:
        local_owner = get_account(user_id)
    playlists = [
        convert_playlist(playlist, user_id, local_owner)
        for playlist in spotify_playlists
        if isinstance(playlist, dict)
    ]
    log(f"Got {len(playlists)} playlists", "debug")
    return playlists


def song_iterator(playlist_id: str, user_id: int, token_user_id: int, user: dict, config):
    return call(
        "spotify@built-in",
        "iter_playlist_songs",
        user_id=user_id,
        playlist_id=playlist_id,
        page_size=int(config("spotify.song_page_size", 50)),
        max_pages=int(config("spotify.max_song_pages", 100)),
        request_delay_ms=int(config("spotify.song_request_delay_ms", 250)),
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
        local_user_id=token_user_id if token_user_id == user_id else None,
        local_user_name=user.get("name") if token_user_id == user_id else None,
        local_user_picture=user.get("avatar_b64") if token_user_id == user_id else None,
    )
