
import time

import requests

from .artist import (
    HEADERS_MB,
    MUSICBRAINZ_BASE,
    _get,
    _name_matches,
    clean_optional,
    load_cache as load_artist_cache,
    search_artist_mb,
)

from .album import load_cache as load_album_cache


def _base_result(album_name=None, song_name=None):
    return {
        "exists": False,
        "artist_exists": False,
        "album_exists": False if album_name else None,
        "song_exists": False if song_name else None,
        "from_cache": False,
        "accuracy": 0.0,
        "status": "not_found",
    }


def _finish(result, start):
    if result.get("status") != "unknown":
        result["exists"] = bool(result["artist_exists"])
        result["status"] = (
            "exists"
            if result["artist_exists"]
            else "not_found"
        )

    result["elapsed_ms"] = round((time.time() - start) * 1000)

    return result


def _unknown_result(album_name=None, song_name=None):
    result = _base_result(
        album_name=album_name,
        song_name=song_name,
    )

    result["exists"] = None
    result["artist_exists"] = None

    if album_name:
        result["album_exists"] = None

    if song_name:
        result["song_exists"] = None

    result["status"] = "unknown"
    result["error"] = "MusicBrainz is temporarily unavailable"
    result["retryable"] = True

    return result


def _unique(values):
    seen = set()
    output = []

    for value in values:
        if not value:
            continue

        key = value.lower().strip()

        if key in seen:
            continue

        seen.add(key)
        output.append(value)

    return output


def _artist_credit_matches(credits, artist_name):
    for credit in credits or []:
        if not isinstance(credit, dict) or "artist" not in credit:
            continue

        if _name_matches(
            credit["artist"].get("name", ""),
            artist_name,
        ):
            return True

    return False


def _find_cached_release(cached_artist, album_name):
    for release in cached_artist.get("releases", []):
        if _name_matches(
            release.get("title", ""),
            album_name,
        ):
            return release

    return None


def _cached_song_exists(cached_album, song_name):
    for song in cached_album.get("songs", []):
        if _name_matches(
            song.get("title", ""),
            song_name,
        ):
            return True

    return False


def _load_album_cache(album_names, artist_names):
    for album_name in _unique(album_names):
        for artist_name in _unique(artist_names):
            cached = load_album_cache(
                album_name,
                artist_name,
            )

            if cached:
                return cached

    return None


def _try_cache(artist_name, album_name=None, song_name=None):
    result = _base_result(
        album_name=album_name,
        song_name=song_name,
    )

    cached_artist = load_artist_cache(artist_name)
    cached_release = None

    artist_names = [artist_name]
    album_names = [album_name]

    if cached_artist:
        result["artist_exists"] = True
        result["accuracy"] = cached_artist.get("accuracy", 1.0)

        canonical_artist = cached_artist.get("name")
        artist_names.append(canonical_artist)

        if album_name:
            cached_release = _find_cached_release(
                cached_artist,
                album_name,
            )

            if cached_release:
                result["album_exists"] = True
                album_names.append(cached_release.get("title"))
            else:
                result["album_exists"] = False

    cached_album = (
        _load_album_cache(album_names, artist_names)
        if album_name
        else None
    )

    if cached_album:
        result["artist_exists"] = True
        result["album_exists"] = True

        result["accuracy"] = max(
            result["accuracy"],
            cached_album.get("accuracy", 1.0),
        )

        if song_name:
            result["song_exists"] = _cached_song_exists(
                cached_album,
                song_name,
            )

            if not result["song_exists"]:
                return None

        result["from_cache"] = True
        return result

    if cached_artist and not album_name and not song_name:
        result["from_cache"] = True
        return result

    if cached_artist and album_name and not cached_release:
        return None

    if cached_artist and album_name and cached_release and not song_name:
        result["from_cache"] = True
        return result

    return None


def _search_recording(artist_name, album_name=None, song_name=None):
    song_name = clean_optional(song_name)
    album_name = clean_optional(album_name)

    query_parts = []

    if song_name:
        query_parts.append(f'recording:"{song_name}"')

    if album_name:
        query_parts.append(f'release:"{album_name}"')

    query_parts.append(f'artist:"{artist_name}"')

    response = _get(
        f"{MUSICBRAINZ_BASE}/recording/",
        params={
            "query": " AND ".join(query_parts),
            "fmt": "json",
            "limit": 5,
        },
        headers=HEADERS_MB,
    )

    for recording in response.json().get("recordings", []):
        if song_name and not _name_matches(
            recording.get("title", ""),
            song_name,
        ):
            continue

        if not _artist_credit_matches(
            recording.get("artist-credit", []),
            artist_name,
        ):
            continue

        if album_name:
            releases = recording.get("releases", [])

            if not any(
                _name_matches(
                    release.get("title", ""),
                    album_name,
                )
                for release in releases
            ):
                continue

        return True

    return False


def _search_album(artist_name, album_name):
    album_name = clean_optional(album_name)

    if not album_name:
        return False

    response = _get(
        f"{MUSICBRAINZ_BASE}/release/",
        params={
            "query": f'release:"{album_name}" AND artist:"{artist_name}"',
            "fmt": "json",
            "limit": 5,
        },
        headers=HEADERS_MB,
    )

    for release in response.json().get("releases", []):
        if not _name_matches(
            release.get("title", ""),
            album_name,
        ):
            continue

        credits = release.get("artist-credit", [])

        if not credits or _artist_credit_matches(
            credits,
            artist_name,
        ):
            return True

    return False


def check_artist_exists(
    artist_name,
    album_name=None,
    song_name=None,
    no_cache=False,
):
    start = time.time()

    album_name = clean_optional(album_name)
    song_name = clean_optional(song_name)

    if not no_cache:
        cached = _try_cache(
            artist_name,
            album_name=album_name,
            song_name=song_name,
        )

        if cached:
            return _finish(cached, start)

    result = _base_result(
        album_name=album_name,
        song_name=song_name,
    )

    try:
        if song_name:
            recording_exists = _search_recording(
                artist_name,
                album_name=album_name,
                song_name=song_name,
            )

            if recording_exists:
                result["artist_exists"] = True
                result["song_exists"] = True

                if album_name:
                    result["album_exists"] = True

                result["accuracy"] = 0.98

        if album_name and result["album_exists"] is not True:
            album_exists = _search_album(
                artist_name,
                album_name,
            )

            if album_exists:
                result["artist_exists"] = True
                result["album_exists"] = True

                result["accuracy"] = max(
                    result["accuracy"],
                    0.95,
                )

        if not result["artist_exists"]:
            musicbrainz_artist, accuracy = search_artist_mb(
                artist_name,
            )

            result["artist_exists"] = bool(musicbrainz_artist)

            result["accuracy"] = max(
                result["accuracy"],
                accuracy,
            )

    except requests.exceptions.RequestException:
        return _finish(
            _unknown_result(
                album_name=album_name,
                song_name=song_name,
            ),
            start,
        )

    return _finish(result, start)
