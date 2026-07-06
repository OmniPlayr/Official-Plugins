from . import routes

from omniplayr.plugins import PluginBase, register, request_db_access

class SoundCloudPlugin(PluginBase):
    source_type = "soundcloud"

    def get_stream(self, song_id: str, account_id: str):
        raise NotImplementedError("SoundCloud uses the HTML5 Widget API; audio is handled in the browser")

    def get_metadata(self, song_id: str, account_id: str) -> dict:
        return routes.get_metadata(account_id, song_id)


def setup():
    db = request_db_access(
        "soundcloud@built-in",
        own={
            "soundcloud_accounts": {
                "account_id": "INT NOT NULL UNIQUE",
                "client_id": "TEXT NOT NULL",
                "client_secret": "TEXT NOT NULL",
                "access_token": "TEXT",
                "refresh_token": "TEXT",
                "token_expiry": "BIGINT",
                "soundcloud_user_id": "TEXT",
                "soundcloud_user_name": "TEXT",
                "soundcloud_user_avatar": "TEXT",
            }
        },
    )
    routes.init(db)
    register(SoundCloudPlugin())
