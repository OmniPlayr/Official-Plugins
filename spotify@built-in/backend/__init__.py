from . import routes

from omniplayr.plugins import request_db_access, PluginBase, register

class SpotifyPlugin(PluginBase):
    source_type = "spotify"

    def get_stream(self, song_id: str, account_id: str):
        raise NotImplementedError("Spotify uses the Web Playback SDK; audio is handled in the browser")

    def get_metadata(self, song_id: str, account_id: str) -> dict:
        return routes.get_metadata(account_id, song_id)


def setup():
    db = request_db_access(
        "spotify@built-in",
        own={
            "spotify_accounts": {
                "account_id": "INT NOT NULL UNIQUE",
                "client_id": "TEXT NOT NULL",
                "access_token": "TEXT",
                "refresh_token": "TEXT",
                "token_expiry": "BIGINT",
                "spotify_user_id": "TEXT",
                "spotify_user_name": "TEXT",
                "spotify_user_avatar": "TEXT",
            }
        }
    )
    routes.init(db)
    register(SpotifyPlugin())
