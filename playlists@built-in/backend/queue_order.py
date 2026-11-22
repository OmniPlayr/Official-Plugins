def queue_request_key(song):
    source_type = song.get("source_type") or song.get("sourceType")
    song_id = song.get("song_id") or song.get("songId")
    return f"{source_type}:{song_id}"


def queue_request_position(song):
    position = song.get("position")
    if position is None:
        position = song.get("playlistPosition")
    try:
        return int(position) if position is not None else None
    except (TypeError, ValueError):
        return None


def ordered_requested_playlist_songs(requested_songs, playlist_songs):
    songs_by_key = {}
    songs_by_position = {}

    for song in playlist_songs:
        key = queue_request_key(song)
        songs_by_key.setdefault(key, []).append(song)
        position = song.get("position")
        if position is not None:
            songs_by_position[position] = song

    occurrence_counts = {}
    ordered = []
    missing = []

    for requested in requested_songs:
        key = queue_request_key(requested)
        position = queue_request_position(requested)
        match = songs_by_position.get(position) if position is not None else None

        if match is None:
            occurrence = occurrence_counts.get(key, 0)
            occurrence_counts[key] = occurrence + 1
            matches = songs_by_key.get(key) or []
            match = matches[occurrence] if occurrence < len(matches) else (matches[0] if matches else None)

        if match is None:
            missing.append(requested)
            continue

        ordered.append(match)

    return ordered, missing