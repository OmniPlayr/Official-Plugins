import base64
import requests as http_requests
from api.helpers.plugins import PluginBase, register
from . import routes
from api.helpers.plugin_db import request_db_access


class SpotifyPlugin(PluginBase):
    source_type = "spotify"

    def get_stream(self, song_id: str, account_id: str):
        raise NotImplementedError("Spotify uses the Web Playback SDK; audio is handled in the browser")

    def get_metadata(self, song_id: str, account_id: str) -> dict:
        access_token = routes.get_access_token(account_id)
        if not access_token:
            return {}

        res = http_requests.get(
            f"https://api.spotify.com/v1/tracks/{song_id}",
            headers={"Authorization": f"Bearer {access_token}"},
        )

        if not res.ok:
            return {}

        data = res.json()
        album = data.get("album", {})
        artists = data.get("artists", [])

        album_art = None
        images = album.get("images", [])
        if images:
            img_res = http_requests.get(images[0]["url"])
            if img_res.ok:
                content_type = img_res.headers.get("Content-Type", "image/jpeg")
                encoded = base64.b64encode(img_res.content).decode()
                album_art = f"data:{content_type};base64,{encoded}"

        release_date = album.get("release_date", "")
        track_number = data.get("track_number")
        duration_ms = data.get("duration_ms")

        return {
            "title": data.get("name"),
            "artist": ", ".join(a["name"] for a in artists) if artists else None,
            "album": album.get("name"),
            "album_artist": ", ".join(a["name"] for a in album.get("artists", [])) or None,
            "year": release_date[:4] if release_date else None,
            "track": str(track_number) if track_number is not None else None,
            "duration": duration_ms / 1000.0 if duration_ms is not None else None,
            "album_art": album_art,
        }


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
