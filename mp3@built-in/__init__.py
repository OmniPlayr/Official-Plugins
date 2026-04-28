from fastapi import Depends, HTTPException, Header
from api.helpers.plugins import PluginBase, register, api
from api.helpers.server import verify_auth, get_token_user
from .paths import resolve_path, EXTENSION_CONTENT_TYPES, MUSIC_DIR
from .metadata import get_content_type, get_file_size, get_metadata
from .streaming import get_stream


class Mp3Plugin(PluginBase):
    source_type = "mp3"

    def check_ownership(self, song_id: str, account_id: int) -> bool:
        try:
            path = resolve_path(song_id, account_id)
            return path.exists() and path.is_file()
        except Exception:
            return False

    def get_content_type(self, song_id: str, account_id: int) -> str:
        return get_content_type(song_id, account_id)

    def get_file_size(self, song_id: str, account_id: int) -> int | None:
        return get_file_size(song_id, account_id)

    def get_metadata(self, song_id: str, account_id: int) -> dict:
        return get_metadata(song_id, account_id)

    def get_stream(self, song_id: str, account_id: int):
        return get_stream(song_id, account_id)


@api.get("/mp3/browse")
def browse_music(auth=Depends(verify_auth), x_account_token: str = Header(..., alias="X-Account-Token")):
    account_id = get_token_user(x_account_token)
    user_dir = MUSIC_DIR / str(account_id)
    if not user_dir.exists():
        return {"files": []}
    files = [
        f"{account_id}/{f.relative_to(user_dir)}"
        for f in user_dir.rglob("*")
        if f.is_file() and f.suffix.lower() in EXTENSION_CONTENT_TYPES
    ]
    return {"files": files}


def setup():
    register(Mp3Plugin())