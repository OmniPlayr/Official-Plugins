from omniplayr.plugins import get_account, log, call, has_function, is_installed

def convert_playlist(playlist: dict, user_id: int, local_owner=None, include_profile_images=False) -> dict:
    user = playlist.get("user") or {}
    connected_user = playlist.get("_connected_user") or {}
    owner_id = str(user.get("id") or "")
    owner_is_connected_user = bool(owner_id and str(connected_user.get("id") or "") == owner_id)

    converted = {
        "id": str(playlist.get("id")),
        "service": "soundcloud",
        "name": playlist.get("title") or "Unknown Playlist",
        "cover": playlist.get("artwork_url") or user.get("avatar_url"),
        "description": playlist.get("description") or None,
        "private": playlist.get("sharing") != "public",
        "owner_id": user_id,
        "is_liked_playlist": False,
        "created_by": None,
        "created_by_name": user.get("username") or "Unknown User",
        "group_id": None,
    }

    if include_profile_images:
        if owner_is_connected_user and local_owner:
            creator_id = user_id
            creator_name = local_owner.get("name") or "Unknown User"
            creator_avatar = local_owner.get("avatar_b64")
            converted["created_by"] = user_id
        else:
            creator_id = f"soundcloud:{owner_id or 'unknown'}"
            creator_name = user.get("username") or "Unknown User"
            creator_avatar = user.get("avatar_url")

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
    if not is_installed("soundcloud@built-in") or not has_function("soundcloud@built-in", "get_playlist"):
        return None

    soundcloud_playlist = call(
        "soundcloud@built-in",
        "get_playlist",
        user_id=user_id,
        playlist_id=playlist_id,
        include_songs=False,
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
    )
    if not isinstance(soundcloud_playlist, dict):
        return None

    return convert_playlist(soundcloud_playlist, user_id, local_owner, include_profile_images=True)


def get_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None, config=None):
    log("Getting SoundCloud playlists", "debug")
    if not is_installed("soundcloud@built-in"):
        log("SoundCloud plugin not installed", "debug")
        return []

    if not has_function("soundcloud@built-in", "get_playlists"):
        log("SoundCloud plugin does not have get_playlists function", "debug")
        return []

    if has_function("soundcloud@built-in", "get_auth_status"):
        status = call(
            "soundcloud@built-in",
            "get_auth_status",
            user_id=user_id,
            timeout_seconds=int(config("requests.timeout_seconds", 10)),
        )
        log(f"SoundCloud auth status for account {user_id}: {status}", "debug")
        if isinstance(status, dict) and not status.get("connected"):
            log("SoundCloud plugin is not connected", "debug")
            return []

    soundcloud_playlists = call(
        "soundcloud@built-in",
        "get_playlists",
        user_id=user_id,
        limit=limit,
        offset=offset,
        force_refresh=True,
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
    )
    if soundcloud_playlists is None:
        return None
    if local_owner is None:
        local_owner = get_account(user_id)
    playlists = [
        convert_playlist(playlist, user_id, local_owner)
        for playlist in soundcloud_playlists
        if isinstance(playlist, dict)
    ]
    log(f"Got {len(playlists)} SoundCloud playlists", "debug")
    return playlists


def song_iterator(playlist_id: str, user_id: int, token_user_id: int, user: dict, config):
    return call(
        "soundcloud@built-in",
        "iter_playlist_songs",
        user_id=user_id,
        playlist_id=playlist_id,
        page_size=int(config("soundcloud.song_page_size", 50)),
        max_pages=int(config("soundcloud.max_song_pages", 100)),
        request_delay_ms=int(config("soundcloud.song_request_delay_ms", 250)),
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
        local_user_id=token_user_id if token_user_id == user_id else None,
        local_user_name=user.get("name") if token_user_id == user_id else None,
        local_user_picture=user.get("avatar_b64") if token_user_id == user_id else None,
    )
