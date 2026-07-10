from omniplayr.plugins import call, get_account, has_function, is_installed, log


def _thumbnail_url(thumbnails):
    if not isinstance(thumbnails, list) or not thumbnails:
        return None
    thumbnail = thumbnails[-1]
    return thumbnail.get("url") if isinstance(thumbnail, dict) else None


def convert_playlist(playlist: dict, user_id: int, local_owner=None, include_profile_images=False) -> dict:
    connected_user = playlist.get("_connected_user") or {}
    playlist_id = playlist.get("playlistId") or playlist.get("id")
    author = playlist.get("author") or connected_user or {}
    creator_name = (
        author.get("name")
        or author.get("title")
        or connected_user.get("name")
        or "Unknown User"
    )

    converted = {
        "id": playlist_id,
        "service": "youtube",
        "name": playlist.get("title") or playlist.get("name") or "Unknown Playlist",
        "cover": _thumbnail_url(playlist.get("thumbnails")),
        "description": playlist.get("description") or None,
        "private": str(playlist.get("privacy") or "").upper() != "PUBLIC",
        "owner_id": user_id,
        "is_liked_playlist": False,
        "created_by": None,
        "created_by_name": creator_name,
        "group_id": None,
    }

    if include_profile_images:
        connected_id = connected_user.get("id")
        author_id = author.get("id") or author.get("channelId") or connected_id
        if connected_id and author_id == connected_id and local_owner:
            creator_id = user_id
            creator_name = local_owner.get("name") or creator_name
            creator_avatar = local_owner.get("avatar_b64") or connected_user.get("avatar")
            converted["created_by"] = user_id
        else:
            creator_id = f"youtube:{author_id or 'unknown'}"
            creator_avatar = author.get("avatar") or connected_user.get("avatar")

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
    if not is_installed("youtube@built-in") or not has_function("youtube@built-in", "get_playlist"):
        return None

    youtube_playlist = call(
        "youtube@built-in",
        "get_playlist",
        user_id=user_id,
        playlist_id=playlist_id,
        include_songs=False,
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
    )
    if not isinstance(youtube_playlist, dict):
        return None

    return convert_playlist(youtube_playlist, user_id, local_owner, include_profile_images=True)


def get_playlists(limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None, config=None):
    log("Getting YouTube Music playlists", "debug")
    if not is_installed("youtube@built-in"):
        log("YouTube plugin not installed", "debug")
        return []

    if not has_function("youtube@built-in", "get_playlists"):
        log("YouTube plugin does not have get_playlists function", "debug")
        return []

    if has_function("youtube@built-in", "get_auth_status"):
        status = call(
            "youtube@built-in",
            "get_auth_status",
            user_id=user_id,
            timeout_seconds=int(config("requests.timeout_seconds", 10)),
        )
        log(f"YouTube Music auth status for account {user_id}: {status}", "debug")
        if isinstance(status, dict) and not status.get("connected"):
            if status.get("configured"):
                log("YouTube Music plugin is configured but not connected", "debug")
            else:
                log("YouTube Music plugin is not configured", "debug")
            return []

    youtube_playlists = call(
        "youtube@built-in",
        "get_playlists",
        user_id=user_id,
        limit=limit,
        offset=offset,
        force_refresh=False,
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
    )
    if youtube_playlists is None:
        log(
            f"YouTube Music provider returned no playlist page for account {user_id} "
            f"(limit={limit}, offset={offset})",
            "debug",
        )
        return None
    if local_owner is None:
        local_owner = get_account(user_id)
    playlists = [
        convert_playlist(playlist, user_id, local_owner)
        for playlist in youtube_playlists
        if isinstance(playlist, dict)
    ]
    log(f"Got {len(playlists)} YouTube Music playlists", "debug")
    return playlists


def song_iterator(playlist_id: str, user_id: int, token_user_id: int, user: dict, config):
    return call(
        "youtube@built-in",
        "iter_playlist_songs",
        user_id=user_id,
        playlist_id=playlist_id,
        page_size=int(config("youtube.song_page_size", 50)),
        max_pages=int(config("youtube.max_song_pages", 100)),
        request_delay_ms=int(config("youtube.song_request_delay_ms", 250)),
        timeout_seconds=int(config("requests.timeout_seconds", 10)),
        local_user_id=token_user_id if token_user_id == user_id else None,
        local_user_name=user.get("name") if token_user_id == user_id else None,
        local_user_picture=user.get("avatar_b64") if token_user_id == user_id else None,
    )
