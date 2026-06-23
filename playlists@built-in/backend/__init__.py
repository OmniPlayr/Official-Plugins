from api.helpers.plugin_db import request_db_access
from . import playlists
from api.helpers.log import log

PLUGIN_KEY = "playlists@built-in"

def setup():
    log(f"Loading built-in playlist plugin, key={PLUGIN_KEY!r}", "debug")
    log("Initializing database", "debug")
    db = request_db_access(
        "playlists@built-in",
        own={
            "playlists": {
                "id": "SERIAL PRIMARY KEY",
                "name": "VARCHAR(255) NOT NULL",
                "cover": "TEXT DEFAULT NULL",
                "description": "TEXT DEFAULT NULL",
                "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "private": "BOOLEAN NOT NULL DEFAULT FALSE",
                "owner_id": "INT NOT NULL",
                "is_liked_playlist": "BOOLEAN NOT NULL DEFAULT FALSE",
                "created_by": "INT DEFAULT NULL",
                "created_by_name": "VARCHAR(255) DEFAULT NULL",
                "created_by_avatar": "TEXT DEFAULT NULL",
                "group_id": "INT DEFAULT NULL"
            },
            "playlist_collaborators": {
                "id": "SERIAL PRIMARY KEY",
                "playlist_id": "INT NOT NULL",
                "account_id": "INT NOT NULL",
                "added_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "permission": "VARCHAR(20) NOT NULL CHECK (permission IN ('admin', 'collaborator'))",
                "name": "VARCHAR(255) DEFAULT NULL",
                "avatar": "TEXT DEFAULT NULL"
            },
            "playlist_songs": {
                "id": "SERIAL PRIMARY KEY",
                "playlist_id": "INT NOT NULL",
                "source_type": "VARCHAR(255) NOT NULL",
                "song_id": "TEXT DEFAULT NULL",
                "path": "TEXT DEFAULT NULL",
                "added_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "added_by": "INT NOT NULL",
                "position": "INT NOT NULL"
            },
            "playlist_groups": {
                "id": "SERIAL PRIMARY KEY",
                "name": "VARCHAR(255) NOT NULL",
                "owner_id": "INT NOT NULL",
                "created_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "updated_at": "TIMESTAMPTZ NOT NULL DEFAULT NOW()",
                "private": "BOOLEAN NOT NULL DEFAULT FALSE"
            }
        }
    )
    if db is None:
        log("Failed to initialize database", "error")
        return
    
    log("Initializing built-in playlist plugin", "debug")
    playlists.init(db)