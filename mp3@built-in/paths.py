from pathlib import Path
from urllib.parse import unquote

from omniplayr.plugins import get_plugin_config

PLUGIN_KEY = "mp3@built-in"

_cfg_dir = get_plugin_config(PLUGIN_KEY, "storage.mp3_music_dir")
MUSIC_DIR = Path(_cfg_dir) if _cfg_dir else Path("/user_storage/mp3")

EXTENSION_CONTENT_TYPES = {
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".opus": "audio/opus",
}


def resolve_path(song_id: str, account_id: int) -> Path:
    decoded = unquote(song_id).replace("\\", "")

    user_dir = (MUSIC_DIR / str(account_id)).resolve()
    if not str(user_dir).startswith(str(MUSIC_DIR.resolve())):
        raise PermissionError("Path traversal detected")

    account_prefix = f"{account_id}/"
    if decoded == str(account_id):
        decoded = ""
    elif decoded.startswith(account_prefix):
        decoded = decoded[len(account_prefix):]

    path = (user_dir / decoded).resolve()

    if not str(path).startswith(str(user_dir)):
        raise PermissionError("Path traversal detected")

    return path
