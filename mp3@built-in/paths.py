from pathlib import Path
from api.helpers.omniplayr import get_plugin_config

PLUGIN_KEY = "mp3@built-in"

_cfg_dir = get_plugin_config(PLUGIN_KEY, "storage.mp3_music_dir")
if _cfg_dir:
    MUSIC_DIR = Path(_cfg_dir)

EXTENSION_CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".opus": "audio/opus",
}


def resolve_path(song_id: str) -> Path:
    decoded = song_id.replace("%2F", "/").replace("%5C", "")
    path = (MUSIC_DIR / decoded).resolve()
    if not str(path).startswith(str(MUSIC_DIR.resolve())):
        raise PermissionError("Path traversal detected")
    return path