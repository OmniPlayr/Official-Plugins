from . import routes

from omniplayr.plugins import register, PluginBase, request_db_access
from .streaming import StreamUnavailableError, get_stream, get_content_type, get_file_size
from .metadata import get_metadata

def _is_youtube_song_id(song_id: str) -> bool:
    value = str(song_id or "")
    return len(value) == 11 and all(char.isalnum() or char in "_-" for char in value)

class YoutubePlugin(PluginBase):
    source_type = "youtube"

    def get_stream(self, song_id: str, account_id: int = None, range_header: str | None = None):
        try:
            return get_stream(song_id, range_header=range_header)
        except StreamUnavailableError as error:
            raise FileNotFoundError(str(error)) from error

    def get_content_type(self, song_id: str, account_id: int = None) -> str:
        return get_content_type(song_id)

    def get_file_size(self, song_id: str, account_id: int = None) -> int | None:
        return get_file_size(song_id)

    def get_metadata(self, song_id: str, account_id: int = None):
        if not _is_youtube_song_id(song_id):
            raise FileNotFoundError(f"Invalid YouTube song ID: {song_id}")

        metadata = routes.get_metadata(account_id, song_id) if account_id else get_metadata(song_id)
        if not metadata or not metadata.get("title"):
            raise FileNotFoundError(f"YouTube video not found: {song_id}")
        return metadata

def setup():
    db = request_db_access(
        "youtube@built-in",
        own={
            "youtube_accounts": {
                "account_id": "INT NOT NULL UNIQUE",
                "client_id": "TEXT NOT NULL",
                "client_secret": "TEXT NOT NULL",
                "access_token": "TEXT",
                "refresh_token": "TEXT",
                "token_expiry": "BIGINT",
                "youtube_user_id": "TEXT",
                "youtube_user_name": "TEXT",
                "youtube_user_avatar": "TEXT",
            }
        },
    )
    routes.init(db)
    register(YoutubePlugin())
