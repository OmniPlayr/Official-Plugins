import re
import time
from collections import OrderedDict
from threading import RLock
from urllib.parse import urlsplit, urlunsplit

import requests
import yt_dlp
from omniplayr.plugins import log

PLUGIN_KEY = "youtube@built-in"

_STREAM_URL_CACHE_TTL = 900
_STREAM_ERROR_CACHE_TTL = 10
_STREAM_URL_CACHE_MAX_ENTRIES = 256
_STREAM_CHUNK_SIZE = 256 * 1024
_DEFAULT_AUDIO_QUALITY = "bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]/bestaudio/best"
_SONG_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
_RETRYABLE_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}
_REFRESHABLE_HTTP_STATUSES = {401, 403, 404, 410}
_MAX_STREAM_READ_RETRIES = 3
_stream_url_cache: OrderedDict[tuple[str, str], dict] = OrderedDict()
_stream_url_cache_lock = RLock()
_stream_resolve_locks: dict[tuple[str, str], RLock] = {}


class StreamUnavailableError(RuntimeError):
    def __init__(self, message: str, *, not_found: bool = False):
        super().__init__(message)
        self.not_found = not_found


class _YTDLPLogger:
    @staticmethod
    def _write_message(message: str) -> str:
        value = str(message or "").strip()
        value = re.sub(
            r"https?://[^\s\"'<>]+",
            lambda match: _redact_url(match.group(0)),
            value,
        )
        return " ".join(value.split())[:500]

    @classmethod
    def _write(cls, message: str, level: str):
        value = cls._write_message(message)
        if value:
            log(f"yt-dlp: {value}", level)

    def debug(self, _message):
        pass

    def warning(self, message):
        self._write(message, "warning")

    def error(self, message):
        self._write(message, "warning")


def _redact_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        return "YouTube URL"


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


def _cache_put(cache_key: tuple[str, str], *, data=None, error: str | None = None, not_found: bool = False):
    with _stream_url_cache_lock:
        _stream_url_cache[cache_key] = {
            "cached_at": time.monotonic(),
            "data": data,
            "error": error,
            "not_found": not_found,
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
        raise StreamUnavailableError(
            cached["error"],
            not_found=cached.get("not_found", False),
        )
    return cached["data"]


def _is_permanently_unavailable(message: str) -> bool:
    value = str(message or "").lower()
    indicators = (
        "video unavailable",
        "this video is unavailable",
        "private video",
        "video is private",
        "has been removed",
        "video has been removed",
        "not available in your country",
    )
    return any(indicator in value for indicator in indicators)


def _stream_error(song_id: str, audio_quality: str, error: Exception, *, cache: bool = True):
    message = _YTDLPLogger._write_message(str(error)) or error.__class__.__name__
    not_found = _is_permanently_unavailable(message)
    if cache and not_found:
        _cache_put(
            (song_id, audio_quality),
            error=message,
            not_found=True,
        )
    safe_message = _yt_dlp_logger._write_message(message)
    log(f"YouTube stream resolution failed for song_id={song_id}: {safe_message}", "warning")
    return StreamUnavailableError(message, not_found=not_found)


def get_stream_url(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY):
    if not _SONG_ID_PATTERN.fullmatch(str(song_id or "")):
        raise StreamUnavailableError("Invalid YouTube song ID", not_found=True)

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
                "no_warnings": False,
                "noplaylist": True,
                "skip_download": True,
                "socket_timeout": 20,
                "extractor_retries": 5,
                "retries": 5,
                "fragment_retries": 5,
                "file_access_retries": 3,
                "logger": _yt_dlp_logger,
            }) as ydl:
                info = ydl.extract_info(
                    f"https://music.youtube.com/watch?v={song_id}",
                    download=False,
                )
        except Exception as error:
            wrapped = _stream_error(song_id, audio_quality, error)
            raise wrapped from error

        if not isinstance(info, dict) or not info.get("url"):
            error = StreamUnavailableError("YouTube did not return a playable audio stream")
            log(f"YouTube stream unavailable for song_id={song_id}: {error}", "warning")
            raise error

        http_headers = info.get("http_headers") or {}
        duration = info.get("duration")
        try:
            duration = int(duration) if duration is not None else None
        except (TypeError, ValueError, OverflowError):
            duration = None

        release_date = str(info.get("release_date") or info.get("upload_date") or "")
        artists = info.get("artists") or []
        if isinstance(artists, list):
            artist_names = [
                str(item.get("name") if isinstance(item, dict) else item).strip()
                for item in artists
                if item
            ]
        else:
            artist_names = [str(artists).strip()] if artists else []
        metadata = {
            "title": info.get("track") or info.get("title"),
            "artist": info.get("artist") or ", ".join(name for name in artist_names if name) or info.get("uploader") or info.get("channel"),
            "album": info.get("album"),
            "album_artist": info.get("album_artist"),
            "year": info.get("release_year") or (release_date[:4] if len(release_date) >= 4 else None),
            "track": info.get("track_number"),
            "duration": duration,
            "thumbnail": info.get("thumbnail"),
        }
        result = {
            "url": info["url"],
            "http_headers": http_headers,
            "mime_type": _mime_from_ext(info.get("ext")) or info.get("mime_type"),
            "file_size": info.get("filesize") or info.get("filesize_approx"),
            "metadata": metadata,
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


def get_stream_metadata(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY) -> dict | None:
    metadata = get_stream_url(song_id, audio_quality).get("metadata")
    return metadata.copy() if isinstance(metadata, dict) else None


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
    refreshed_url = False
    for attempt in range(3):
        stream_info = get_stream_url(song_id, audio_quality)
        headers = stream_info["http_headers"].copy()
        headers["Accept-Encoding"] = "identity"
        if range_header:
            headers["Range"] = range_header

        response = None
        try:
            response = requests.get(
                stream_info["url"],
                headers=headers,
                allow_redirects=True,
                stream=True,
                timeout=(10, 60),
            )
            response.raise_for_status()
            return response
        except requests.HTTPError as error:
            status_code = error.response.status_code if error.response is not None else None
            if error.response is not None:
                error.response.close()

            if status_code in _REFRESHABLE_HTTP_STATUSES and not refreshed_url:
                _invalidate_stream_url(song_id, audio_quality)
                refreshed_url = True
                log(f"Refreshing YouTube stream URL after HTTP {status_code} for song_id={song_id}", "warning")
                continue

            if status_code in _RETRYABLE_HTTP_STATUSES and attempt < 2:
                delay = min(2 ** attempt, 4)
                log(
                    f"Retrying YouTube stream request after HTTP {status_code} "
                    f"for song_id={song_id} in {delay}s",
                    "warning",
                )
                time.sleep(delay)
                continue

            safe_error = _YTDLPLogger._write_message(str(error)) or error.__class__.__name__
            log(f"YouTube stream request failed for song_id={song_id}: {safe_error}", "warning")
            raise StreamUnavailableError(safe_error) from error
        except requests.RequestException as error:
            if response is not None:
                response.close()
            if attempt < 2:
                delay = min(2 ** attempt, 4)
                log(
                    f"Retrying YouTube stream connection for song_id={song_id} "
                    f"in {delay}s: {_YTDLPLogger._write_message(str(error))}",
                    "warning",
                )
                time.sleep(delay)
                continue
            safe_error = _YTDLPLogger._write_message(str(error)) or error.__class__.__name__
            log(f"YouTube stream request failed for song_id={song_id}: {safe_error}", "warning")
            raise StreamUnavailableError(safe_error) from error

    raise StreamUnavailableError("YouTube stream request failed")


def _parse_range_header(range_header: str | None):
    if not range_header:
        return 0, None
    match = re.fullmatch(r"bytes=(\d+)-(\d*)", range_header.strip(), re.IGNORECASE)
    if not match:
        return None, None
    start = int(match.group(1))
    end = int(match.group(2)) if match.group(2) else None
    if end is not None and end < start:
        return None, None
    return start, end


def _range_header(start: int, end: int | None) -> str:
    return f"bytes={start}-{end if end is not None else ''}"


def _response_chunks(response, song_id: str, audio_quality: str, range_header: str | None):
    range_start, range_end = _parse_range_header(range_header)
    range_supported = range_start is not None
    range_start = range_start or 0
    bytes_sent = 0
    retries = 0
    current_response = response
    current_range = range_header

    while True:
        response_read = 0
        bytes_to_skip = range_start + bytes_sent if current_response.status_code == 200 and current_range else 0
        content_length_value = current_response.headers.get("Content-Length")
        expected_response_length = int(content_length_value) if content_length_value and content_length_value.isdigit() else None

        try:
            with current_response:
                content_range = current_response.headers.get("Content-Range", "")
                content_range_match = re.match(r"^bytes (\d+)-(\d+)/(\d+|\*)$", content_range)
                expected_start = range_start + bytes_sent
                if current_response.status_code == 206 and content_range_match:
                    returned_start = int(content_range_match.group(1))
                    if returned_start != expected_start:
                        raise StreamUnavailableError(
                            f"YouTube returned byte range {returned_start}, expected {expected_start}"
                        )

                for chunk in current_response.iter_content(chunk_size=_STREAM_CHUNK_SIZE):
                    if not chunk:
                        continue
                    response_read += len(chunk)
                    if bytes_to_skip:
                        if len(chunk) <= bytes_to_skip:
                            bytes_to_skip -= len(chunk)
                            continue
                        chunk = chunk[bytes_to_skip:]
                        bytes_to_skip = 0

                    if range_supported and range_end is not None:
                        remaining = range_end - (range_start + bytes_sent) + 1
                        if remaining <= 0:
                            return
                        if len(chunk) > remaining:
                            chunk = chunk[:remaining]

                    if chunk:
                        bytes_sent += len(chunk)
                        yield chunk

                    if range_supported and range_end is not None and bytes_sent >= range_end - range_start + 1:
                        return

                if bytes_to_skip:
                    raise requests.exceptions.ChunkedEncodingError(
                        "YouTube ended the response before the requested byte offset"
                    )

                expected_range_length = (range_end - range_start + 1) if range_supported and range_end is not None else None
                if expected_range_length is not None and bytes_sent < expected_range_length:
                    raise requests.exceptions.ChunkedEncodingError(
                        "YouTube ended the response before the requested byte range was complete"
                    )

                if expected_response_length is not None and response_read < expected_response_length:
                    raise requests.exceptions.ChunkedEncodingError(
                        "YouTube ended the audio response before all bytes arrived"
                    )
                return
        except requests.RequestException as error:
            safe_error = _YTDLPLogger._write_message(str(error)) or error.__class__.__name__
            if retries >= _MAX_STREAM_READ_RETRIES:
                log(f"YouTube stream interrupted while reading song_id={song_id}: {safe_error}", "warning")
                raise StreamUnavailableError(f"YouTube stream interrupted: {safe_error}") from error

            retries += 1
            next_offset = range_start + bytes_sent
            current_range = _range_header(next_offset, range_end)
            delay = min(retries, 2)
            log(
                f"Resuming YouTube stream for song_id={song_id} from byte {next_offset} "
                f"after a read error; retry {retries}/{_MAX_STREAM_READ_RETRIES}",
                "warning",
            )
            time.sleep(delay)
            current_response = _open_stream_response(song_id, audio_quality, current_range)


def get_stream(song_id: str, audio_quality: str = _DEFAULT_AUDIO_QUALITY, range_header: str | None = None):
    response = _open_stream_response(song_id, audio_quality, range_header)
    return _response_chunks(response, song_id, audio_quality, range_header)
