from . import routes

from omniplayr.plugins import register, PluginBase, request_db_access
from .streaming import get_stream, get_content_type, get_file_size
from .metadata import get_metadata

class YoutubePlugin(PluginBase):
    source_type = "youtube"

    def get_stream(self, song_id: str, account_id: int = None, range_header: str | None = None):
        return get_stream(song_id, range_header=range_header)

    def get_content_type(self, song_id: str, account_id: int = None) -> str:
        return get_content_type(song_id)

    def get_file_size(self, song_id: str, account_id: int = None) -> int | None:
        return get_file_size(song_id)

    def get_metadata(self, song_id: str, account_id: int = None):
        return routes.get_metadata(account_id, song_id) if account_id else get_metadata(song_id)

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
