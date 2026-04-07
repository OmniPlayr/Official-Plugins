from fastapi import Depends, HTTPException
from api.helpers.omniplayr import PluginBase, register, api
from api.helpers.server import verify_auth
from .paths import resolve_path, EXTENSION_CONTENT_TYPES
from .metadata import get_content_type, get_file_size, get_metadata
from .streaming import get_stream


class Mp3Plugin(PluginBase):
    source_type = "mp3"

    def get_content_type(self, song_id: str) -> str:
        return get_content_type(song_id)

    def get_file_size(self, song_id: str) -> int | None:
        return get_file_size(song_id)

    def get_metadata(self, song_id: str) -> dict:
        return get_metadata(song_id)

    def get_stream(self, song_id: str):
        return get_stream(song_id)


@api.get("/mp3/browse")
def browse_music(auth=Depends(verify_auth)):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    from .paths import MUSIC_DIR
    if not MUSIC_DIR.exists():
        return {"files": []}
    files = [
        str(f.relative_to(MUSIC_DIR))
        for f in MUSIC_DIR.rglob("*")
        if f.is_file() and f.suffix.lower() in EXTENSION_CONTENT_TYPES
    ]
    return {"files": files}


def setup():
    register(Mp3Plugin())