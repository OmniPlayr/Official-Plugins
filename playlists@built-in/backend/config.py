from fastapi import HTTPException
from omniplayr.plugins import get_plugin_config

PLUGIN_KEY = "playlists@built-in"
SUPPORTED_SERVICES = {"local", "spotify", "soundcloud", "youtube"}
REMOTE_SERVICES = ("spotify", "soundcloud", "youtube")
DEFAULT_SERVICES = "local,spotify,soundcloud,youtube"
FREQUENT_LIMIT = 8
SERVICE_LABELS = {
    "spotify": "Spotify",
    "soundcloud": "SoundCloud",
    "youtube": "YouTube Music",
}


def config(key, default=None):
    return get_plugin_config(PLUGIN_KEY, key, default=default)


def resolve_options(limit, offset, services):
    default_limit = int(config("pagination.default_limit", 20))
    default_offset = int(config("pagination.default_offset", 0))
    max_limit = int(config("pagination.max_limit", 50))
    resolved_limit = default_limit if limit is None else limit
    resolved_offset = default_offset if offset is None else offset

    if resolved_limit < 1 or resolved_limit > max_limit:
        raise HTTPException(status_code=400, detail=f"limit must be between 1 and {max_limit}")
    if resolved_offset < 0:
        raise HTTPException(status_code=400, detail="offset must be at least 0")

    configured_services = str(config("providers.default_services", DEFAULT_SERVICES))
    if services is None and "youtube" not in {
        str(service).strip().lower()
        for service in configured_services.split(",")
        if str(service).strip()
    }:
        configured_services = f"{configured_services},youtube"
    requested = services.split(",") if services is not None else configured_services.split(",")
    requested_services = {
        "local" if str(service).strip().lower() == "omniplayr" else str(service).strip().lower()
        for service in requested
        if str(service).strip()
    }
    invalid_services = requested_services - SUPPORTED_SERVICES
    if not requested_services or invalid_services:
        invalid = ", ".join(sorted(invalid_services)) or "none"
        raise HTTPException(status_code=400, detail=f"Invalid playlist services: {invalid}")
    if not bool(config("providers.check_spotify_playlists", True)):
        requested_services.discard("spotify")
    if not bool(config("providers.check_soundcloud_playlists", True)):
        requested_services.discard("soundcloud")
    if not bool(config("providers.check_youtube_playlists", True)):
        requested_services.discard("youtube")

    return resolved_limit, resolved_offset, requested_services


def resolve_services(services):
    _, _, requested_services = resolve_options(None, None, services)
    return requested_services


def split_playlist_id(playlist_id: str):
    if ":" in playlist_id:
        raw_playlist_id, service = playlist_id.rsplit(":", 1)
        service = service.lower()
    else:
        raw_playlist_id, service = playlist_id, "local"
    if service == "omniplayr":
        service = "local"
    if service not in SUPPORTED_SERVICES:
        raise HTTPException(status_code=400, detail=f"Unsupported playlist service: {service}")
    return raw_playlist_id, service