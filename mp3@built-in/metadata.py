from __future__ import annotations
import base64
import io
from pathlib import Path

from .paths import resolve_path, EXTENSION_CONTENT_TYPES

try:
    from mutagen import File as MutagenFile
    from mutagen.id3 import ID3NoHeaderError
    from mutagen.mp3 import MP3
    from mutagen.flac import FLAC
    from mutagen.mp4 import MP4
    from mutagen.oggvorbis import OggVorbis
    from mutagen.wave import WAVE
    _MUTAGEN_OK = True
except ImportError:
    _MUTAGEN_OK = False

print(f"[DEBUG] mutagen available: {_MUTAGEN_OK}", flush=True)

def get_content_type(song_id: str) -> str:
    try:
        path = resolve_path(song_id)
        return EXTENSION_CONTENT_TYPES.get(path.suffix.lower(), "audio/mpeg")
    except Exception:
        return "audio/mpeg"


def get_file_size(song_id: str) -> int | None:
    try:
        return resolve_path(song_id).stat().st_size
    except Exception:
        return None


def _extract_album_art_b64(audio) -> str | None:
    if audio is None:
        return None

    if hasattr(audio, "tags") and audio.tags is not None:
        tags = audio.tags
        for key in tags.keys():
            if key.startswith("APIC"):
                frame = tags[key]
                mime = getattr(frame, "mime", "image/jpeg")
                return f"data:{mime};base64,{base64.b64encode(frame.data).decode()}"

    if hasattr(audio, "pictures") and audio.pictures:
        pic = audio.pictures[0]
        mime = getattr(pic, "mime", "image/jpeg")
        return f"data:{mime};base64,{base64.b64encode(pic.data).decode()}"

    if hasattr(audio, "tags") and audio.tags is not None:
        covr = audio.tags.get("covr")
        if covr:
            raw = bytes(covr[0])
            mime = "image/jpeg"
            if raw[:4] == b"\x89PNG":
                mime = "image/png"
            return f"data:{mime};base64,{base64.b64encode(raw).decode()}"

    if hasattr(audio, "tags") and audio.tags is not None:
        mbp = audio.tags.get("metadata_block_picture") or audio.tags.get("METADATA_BLOCK_PICTURE")
        if mbp:
            try:
                from mutagen.flac import Picture
                pic = Picture(base64.b64decode(mbp[0]))
                mime = pic.mime or "image/jpeg"
                return f"data:{mime};base64,{base64.b64encode(pic.data).decode()}"
            except Exception:
                pass

    return None


def _extract_tag(audio, *keys: str) -> str | None:
    if audio is None or not hasattr(audio, "tags") or audio.tags is None:
        return None
    tags = audio.tags
    for key in keys:
        val = tags.get(key)
        if val is None:
            continue
        if hasattr(val, "text"):
            text = str(val.text[0]) if val.text else None
        elif isinstance(val, list):
            text = str(val[0]) if val else None
        else:
            text = str(val)
        if text:
            return text
    return None


def get_metadata(song_id: str) -> dict:
    path = resolve_path(song_id)

    base: dict = {
        "filename": path.name,
        "extension": path.suffix.lower(),
        "file_size": None,
        "duration": None,
        "title": None,
        "artist": None,
        "album": None,
        "album_artist": None,
        "year": None,
        "track": None,
        "genre": None,
        "album_art": None,
    }

    try:
        base["file_size"] = path.stat().st_size
    except Exception:
        pass

    if not _MUTAGEN_OK:
        return base

    try:
        audio = MutagenFile(path, easy=False)
        if audio is None:
            return base

        if hasattr(audio, "info") and hasattr(audio.info, "length"):
            base["duration"] = round(audio.info.length, 3)

        base["album_art"] = _extract_album_art_b64(audio)

        ext = path.suffix.lower()

        if ext == ".mp3":
            base["title"] = _extract_tag(audio, "TIT2")
            base["artist"] = _extract_tag(audio, "TPE1")
            base["album"] = _extract_tag(audio, "TALB")
            base["album_artist"] = _extract_tag(audio, "TPE2")
            base["year"] = _extract_tag(audio, "TDRC", "TYER")
            base["track"] = _extract_tag(audio, "TRCK")
            base["genre"] = _extract_tag(audio, "TCON")

        elif ext == ".flac":
            base["title"] = _extract_tag(audio, "title", "TITLE")
            base["artist"] = _extract_tag(audio, "artist", "ARTIST")
            base["album"] = _extract_tag(audio, "album", "ALBUM")
            base["album_artist"] = _extract_tag(audio, "albumartist", "ALBUMARTIST")
            base["year"] = _extract_tag(audio, "date", "DATE", "year", "YEAR")
            base["track"] = _extract_tag(audio, "tracknumber", "TRACKNUMBER")
            base["genre"] = _extract_tag(audio, "genre", "GENRE")

        elif ext in (".m4a", ".aac"):
            base["title"] = _extract_tag(audio, "\xa9nam")
            base["artist"] = _extract_tag(audio, "\xa9ART")
            base["album"] = _extract_tag(audio, "\xa9alb")
            base["album_artist"] = _extract_tag(audio, "aART")
            base["year"] = _extract_tag(audio, "\xa9day")
            base["track"] = _extract_tag(audio, "trkn")
            base["genre"] = _extract_tag(audio, "\xa9gen")

        elif ext in (".ogg", ".opus"):
            base["title"] = _extract_tag(audio, "title", "TITLE")
            base["artist"] = _extract_tag(audio, "artist", "ARTIST")
            base["album"] = _extract_tag(audio, "album", "ALBUM")
            base["album_artist"] = _extract_tag(audio, "albumartist", "ALBUMARTIST")
            base["year"] = _extract_tag(audio, "date", "DATE")
            base["track"] = _extract_tag(audio, "tracknumber", "TRACKNUMBER")
            base["genre"] = _extract_tag(audio, "genre", "GENRE")

        elif ext == ".wav":
            base["title"] = _extract_tag(audio, "TIT2")
            base["artist"] = _extract_tag(audio, "TPE1")
            base["album"] = _extract_tag(audio, "TALB")
            base["year"] = _extract_tag(audio, "TDRC", "TYER")
            base["genre"] = _extract_tag(audio, "TCON")

    except Exception as exc:
        print(f"[WARN] metadata extraction failed for {song_id}: {exc}", flush=True)

    return base