import re
import time
from collections import OrderedDict
from threading import RLock

import requests
import yt_dlp
from omniplayr.plugins import log
from yt_dlp.utils import DownloadError

PLUGIN_KEY = "youtube@built-in"

_STREAM_URL_CACHE_TTL = 900
_STREAM_ERROR_CACHE_TTL = 60
_STREAM_URL_CACHE_MAX_ENTRIES = 256
_STREAM_CHUNK_SIZE = 256 * 1024
_DEFAULT_AUDIO_QUALITY = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best"
_SONG_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
_stream_url_cache: OrderedDict[tuple[str, str], dict] = OrderedDict()
_stream_url_cache_lock = RLock()
_stream_resolve_locks: dict[tuple[str, str], RLock] = {}


class StreamUnavailableError(RuntimeError):
    pass


class _YTDLPLogger:
    def debug(self, _message):
        pass

    def warning(self, _message):
        pass

    def error(self, _message):
        pass


_yt_dlp_logger = _YTDLPLogger()


def _cache_get(cache_key: tuple[str, str]):
    with _stream_url_cache_lock:
        cached = _stream_url_cache.get(cache_key)
        if not cached:
            return None
        ttl = _STREAM_ERROR_CACHE_TTL if cached.get("error") else _STREAM_URL_CACHE_TTL
        if time.monotonic() - cached["cached_at"] >= ttl:
            _stream_url_cache.pop(cache_key, None)
            return None
        _stream_url_cache.move_to_end(cache_key)
        return cached


def _cache_put(cache_key: tuple[str, str], *, data=None, error: str | None = None):
    with _stream_url_cache_lock:
        _stream_url_cache[cache_key] = {
            "cached_at": time.monotonic(),
            "data": data,
            "error": error,
        }
        _stream_url_cache.move_to_end(cache_key)
        while len(_stream_url_cache) > _STREAM_URL_CACHE_MAX_ENTRIES:
            _stream_url_cache.popitem(last=False)


def _resolve_lock(cache_key: tuple[str, str]) -> RLock:
    with _stream_url_cache_lock:
        return _stream_resolve_locks.setdefault(cache_key, RLock())


def _invalidate_stream_url(song_id: str, audio_quality: str) -> None:
    with _stream_url_cache_lock:
        _stream_url_cache.pop((song_id, audio_quality), None)


def _cached_result(cache_key: tuple[str, str]):
    cached = _cache_get(cache_key)
    if not cached:
        return None
    if cached.get("error"):
        raise StreamUnavailableError(cached["error"])
    return cached["data"]


def get_stream_url(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY):
    if not _SONG_ID_PATTERN.fullmatch(str(song_id or "")):
        raise StreamUnavailableError("Invalid YouTube song ID")

    cache_key = (song_id, audio_quality)
    cached = _cached_result(cache_key)
    if cached:
        log(f"Using cached stream URL for song_id={song_id}", "debug")
        return cached

    with _resolve_lock(cache_key):
        cached = _cached_result(cache_key)
        if cached:
            return cached

        started_at = time.monotonic()
        log(f"Resolving YouTube stream for song_id={song_id}", "debug")
        try:
            with yt_dlp.YoutubeDL({
                "format": audio_quality,
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "socket_timeout": 10,
                "extractor_retries": 1,
                "retries": 1,
                "logger": _yt_dlp_logger,
            }) as ydl:
                info = ydl.extract_info(
                    f"https://music.youtube.com/watch?v={song_id}",
                    download=False,
                )
        except DownloadError as error:
            message = str(error)
            _cache_put(cache_key, error=message)
            log(f"YouTube stream unavailable for song_id={song_id}: {message}", "debug")
            raise StreamUnavailableError(message) from error

        if not isinstance(info, dict) or not info.get("url"):
            message = "YouTube did not return a playable audio stream"
            _cache_put(cache_key, error=message)
            raise StreamUnavailableError(message)

        http_headers = info.get("http_headers", {})
        result = {
            "url": info["url"],
            "http_headers": http_headers,
            "mime_type": _mime_from_ext(info.get("ext")) or info.get("mime_type"),
            "file_size": info.get("filesize") or _exact_file_size(info["url"], http_headers),
        }
        _cache_put(cache_key, data=result)
        log(
            f"Resolved YouTube stream for song_id={song_id} in "
            f"{time.monotonic() - started_at:.2f} seconds",
            "debug",
        )
        return result


def _mime_from_ext(ext: str | None) -> str | None:
    if ext == "m4a":
        return "audio/mp4"
    if ext == "mp4":
        return "audio/mp4"
    if ext == "webm":
        return "audio/webm"
    if ext == "mp3":
        return "audio/mpeg"
    if ext == "opus":
        return "audio/ogg"
    return None


def _exact_file_size(url: str, headers: dict) -> int | None:
    try:
        response = requests.get(
            url,
            headers={**headers, "Range": "bytes=0-0"},
            allow_redirects=True,
            stream=True,
            timeout=(10, 15),
        )
        with response:
            if response.status_code == 206:
                content_range = response.headers.get("Content-Range", "")
                match = re.search(r"/(\d+)\s*$", content_range)
                if match:
                    return int(match.group(1))

            if response.status_code == 200:
                content_length = response.headers.get("Content-Length")
                if content_length and content_length.isdigit():
                    return int(content_length)
    except requests.RequestException as error:
        log(f"Could not determine exact YouTube stream size: {error}", "debug")

    return None


def get_content_type(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY):
    try:
        return get_stream_url(song_id, audio_quality).get("mime_type") or "application/octet-stream"
    except StreamUnavailableError:
        return "application/octet-stream"


def get_file_size(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY):
    try:
        return get_stream_url(song_id, audio_quality).get("file_size")
    except StreamUnavailableError:
        return None


def _open_stream_response(song_id: str, audio_quality: str, range_header: str | None):
    for attempt in range(2):
        try:
            stream_info = get_stream_url(song_id, audio_quality)
        except StreamUnavailableError:
            raise

        headers = stream_info["http_headers"].copy()
        if range_header:
            headers["Range"] = range_header

        try:
            response = requests.get(
                stream_info["url"],
                headers=headers,
                allow_redirects=True,
                stream=True,
                timeout=(10, 30),
            )
            response.raise_for_status()
            return response
        except requests.HTTPError as error:
            if error.response is not None:
                error.response.close()
            if attempt == 0 and error.response is not None and error.response.status_code in {401, 403, 404, 410}:
                _invalidate_stream_url(song_id, audio_quality)
                log(f"Refreshing expired YouTube stream URL for song_id={song_id}", "debug")
                continue
            log(f"YouTube stream request failed for song_id={song_id}: {error}", "warning")
            raise StreamUnavailableError(str(error)) from error
        except requests.RequestException as error:
            log(f"YouTube stream request failed for song_id={song_id}: {error}", "warning")
            raise StreamUnavailableError(str(error)) from error

    raise StreamUnavailableError("YouTube stream request failed")


def _response_chunks(response):
    with response:
        for chunk in response.iter_content(chunk_size=_STREAM_CHUNK_SIZE):
            if chunk:
                yield chunk


def get_stream(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY, range_header: str | None = None):
    return _response_chunks(_open_stream_response(song_id, audio_quality, range_header))
