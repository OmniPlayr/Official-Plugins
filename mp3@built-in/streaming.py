from .paths import resolve_path
from pathlib import Path
from api.helpers.omniplayr import get_plugin_config

PLUGIN_KEY = "mp3@built-in"

_cfg_dir = get_plugin_config(PLUGIN_KEY, "streaming.default_chunk_size")
if isinstance(_cfg_dir, int):
    DEFAULT_CHUNK_SIZE = _cfg_dir
elif isinstance(_cfg_dir, str) and _cfg_dir.isdigit():
    DEFAULT_CHUNK_SIZE = int(_cfg_dir)
else:
    DEFAULT_CHUNK_SIZE = 0

def get_stream(song_id: str, chunk_size: int = DEFAULT_CHUNK_SIZE):
    path = resolve_path(song_id)

    if not path.exists() or not path.is_file():
        raise FileNotFoundError(f"File not found: {path}")

    def _iter_chunks():
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(chunk_size)
                if not chunk:
                    break
                yield chunk

    return _iter_chunks()