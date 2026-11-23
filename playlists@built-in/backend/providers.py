from omniplayr.plugins import get_account, has_function

from .cache import (
    cache_is_stale,
    full_path,
    page_path,
    read_cached_page,
    read_full_cache,
    read_json,
    cache_path,
    start_refresh,
    write_cached_page,
    write_detail,
    write_full_cache,
)
from .config import config
from .services import soundcloud as soundcloud_service
from .services import spotify as spotify_service
from .services import youtube as youtube_service

SERVICE_MODULES = {
    "spotify": spotify_service,
    "soundcloud": soundcloud_service,
    "youtube": youtube_service,
}

PROVIDER_KEYS = {
    "spotify": "spotify@built-in",
    "soundcloud": "soundcloud@built-in",
    "youtube": "youtube@built-in",
}


def fetch_playlists(service: str, limit: int = 10, offset: int = 0, user_id: int = None, local_owner=None):
    return SERVICE_MODULES[service].get_playlists(
        limit=limit,
        offset=offset,
        user_id=user_id,
        local_owner=local_owner,
        config=config,
    )


def refresh_page(service: str, user_id: int, limit: int, offset: int, local_owner):
    playlists = fetch_playlists(service, limit=limit, offset=offset, user_id=user_id, local_owner=local_owner)
    if playlists is not None:
        write_cached_page(user_id, service, limit, offset, playlists)
    return playlists


def get_page(service: str, user_id: int, limit: int, offset: int, local_owner, refresh_cached=True):
    full = read_full_cache(user_id, service)
    playlist_ttl = max(0, int(config("cache.playlist_ttl_seconds", 900)))
    refresh_enabled = (
        refresh_cached
        and bool(config("cache.enabled", True))
        and bool(config("cache.refresh_in_background", True))
    )
    if full is not None:
        if refresh_enabled and cache_is_stale(full_path(user_id, service), playlist_ttl):
            start_refresh(f"{service}-full-{user_id}", refresh_full, service, user_id, local_owner)
        return full[offset:offset + limit], True

    page_size = min(50, max(limit, int(config(f"{service}.request_page_size", 50))))
    cached = read_cached_page(user_id, service, page_size, offset)
    if cached is not None:
        if refresh_enabled and cache_is_stale(page_path(user_id, service, page_size, offset), playlist_ttl):
            start_refresh(
                f"{service}-page-{user_id}-{offset}-{page_size}",
                refresh_page,
                service,
                user_id,
                page_size,
                offset,
                local_owner,
            )
        return cached[:limit], True

    playlists = refresh_page(service, user_id, page_size, offset, local_owner)
    return (playlists[:limit] if playlists is not None else None), False


def fetch_all_playlists(service: str, user_id: int, local_owner, first_page=None):
    page_size = min(50, max(1, int(config(f"{service}.request_page_size", 50))))
    max_pages = max(1, int(config(f"{service}.max_playlist_pages", 100)))
    playlists = list(first_page) if first_page is not None else []
    offset = len(playlists)
    if first_page is not None and len(first_page) < page_size:
        return playlists
    for _ in range(max_pages - (1 if first_page is not None else 0)):
        page = fetch_playlists(service, limit=page_size, offset=offset, user_id=user_id, local_owner=local_owner)
        if not page:
            break
        playlists.extend(page)
        if len(page) < page_size:
            break
        offset += page_size
    return playlists


def refresh_full(service: str, user_id: int, local_owner, first_page=None):
    playlists = fetch_all_playlists(service, user_id, local_owner, first_page)
    write_full_cache(user_id, service, playlists)
    return playlists


def get_full(service: str, user_id: int, local_owner, refresh_cached=True):
    cached = read_full_cache(user_id, service)
    playlist_ttl = max(0, int(config("cache.playlist_ttl_seconds", 900)))
    refresh_enabled = (
        refresh_cached
        and bool(config("cache.enabled", True))
        and bool(config("cache.refresh_in_background", True))
    )
    if cached is not None:
        stale = cache_is_stale(full_path(user_id, service), playlist_ttl)
        if refresh_enabled and stale:
            start_refresh(f"{service}-full-{user_id}", refresh_full, service, user_id, local_owner)
        return cached, True, refresh_enabled and stale

    page_size = min(50, max(1, int(config(f"{service}.request_page_size", 50))))
    playlists, cached_page = get_page(service, user_id, page_size, 0, local_owner, refresh_cached=False)
    if playlists is None:
        return [], False, False

    cached_page_stale = cached_page and cache_is_stale(page_path(user_id, service, page_size, 0), playlist_ttl)
    first_page = None if cached_page and (len(playlists) < page_size or cached_page_stale) else playlists
    if refresh_enabled:
        if first_page is None:
            start_refresh(f"{service}-full-{user_id}", refresh_full, service, user_id, local_owner)
        else:
            start_refresh(f"{service}-full-{user_id}", refresh_full, service, user_id, local_owner, first_page)
        return playlists, False, True

    full_playlists = fetch_all_playlists(service, user_id, local_owner, first_page)
    if not full_playlists:
        full_playlists = playlists
    write_full_cache(user_id, service, full_playlists)
    return full_playlists, False, False


def refresh_detail(service: str, playlist_id: str, user_id: int, local_owner):
    playlist = SERVICE_MODULES[service].refresh_detail(playlist_id, user_id, local_owner, config)
    if playlist is not None:
        write_detail(user_id, service, playlist_id, playlist)
    return playlist


def refresh_detail_for_user(service: str, playlist_id: str, user_id: int):
    return refresh_detail(service, playlist_id, user_id, get_account(user_id))


def get_detail(service: str, playlist_id: str, user_id: int):
    cached = read_json(cache_path(user_id, service, playlist_id, detail=True))
    if isinstance(cached, dict):
        ttl = max(0, int(config("cache.playlist_ttl_seconds", 900)))
        detail_file = cache_path(user_id, service, playlist_id, detail=True)
        if (
            bool(config("cache.enabled", True))
            and bool(config("cache.refresh_in_background", True))
            and cache_is_stale(detail_file, ttl)
        ):
            start_refresh(
                f"{service}-detail-{user_id}-{playlist_id}",
                refresh_detail_for_user,
                service,
                playlist_id,
                user_id,
            )
        return cached
    return refresh_detail_for_user(service, playlist_id, user_id)


def song_iterator(service: str, playlist_id: str, user_id: int, token_user_id: int, user):
    return SERVICE_MODULES[service].song_iterator(playlist_id, user_id, token_user_id, user, config)


def supports_song_streaming(service: str) -> bool:
    return has_function(PROVIDER_KEYS[service], "iter_playlist_songs")