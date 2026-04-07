from fastapi import Depends, HTTPException, Query
from api.helpers.omniplayr import api
from api.helpers.server import verify_auth
from .artist import get_artist_info
from .album import get_album_info

@api.get("/artist/{artist}")
def browse_music(
    artist: str,
    no_cache: bool = Query(default=False),
    song: str | None = Query(default=None),
    album: str | None = Query(default=None),
    auth=Depends(verify_auth)
):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return get_artist_info(artist, song_name=song, album_name=album, no_cache=no_cache)

@api.get("/album/{album}")
def browse_album(
    album: str,
    artist: str = Query(...),
    song: str | None = Query(default=None),
    no_cache: bool = Query(default=False),
    auth=Depends(verify_auth),
):
    if not auth:
        raise HTTPException(status_code=401, detail="Unauthorized")
    return get_album_info(album, artist_name=artist, song_name=song, no_cache=no_cache)
 