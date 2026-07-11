import { currentQueueSong } from "./metadata";
import { player } from "@omniplayr/plugins";

interface LyricsResult { syncedLyrics: string | null; plainLyrics: string | null; }

const LYRICS_STORAGE_PREFIX = 'lyrics:';

async function search(title: string, artist: string | null, album: string | null, duration: number | null) {
    if (!title) return;

    const queryParams = new URLSearchParams();
    if (title) queryParams.set('track_name', title);
    if (album) queryParams.set('album_name', album);
    if (artist) queryParams.set('artist_name', artist);
    if (duration) queryParams.set('duration', duration.toString());

    const response = await fetch(`https://lrclib.net/api/search?${queryParams.toString()}`);
    const results = await response.json() as LyricsResult[];

    return results[0] ?? null;
}

async function getExactLyrics(title: string, artist: string, album: string, duration: number) {
    if (!title || !artist || !album || !duration) return;

    const queryParams = new URLSearchParams({
        track_name: title,
        artist_name: artist,
        album_name: album,
        duration: duration.toString(),
    });

    const response = await fetch(`https://lrclib.net/api/get?${queryParams.toString()}`);

    if (!response.ok) return null;

    return response.json() as Promise<LyricsResult>;
}

function getLyricsStorageKey(title: string, artist: string | null, album: string | null, duration: number) {
    return `${LYRICS_STORAGE_PREFIX}${JSON.stringify({
        title,
        artist,
        album,
        duration: Math.round(duration),
    })}`;
}

function readStoredLyrics(storageKey: string) {
    const storedLyrics = window.sessionStorage.getItem(storageKey);

    if (!storedLyrics) return null;

    try {
        return JSON.parse(storedLyrics) as LyricsResult;
    } catch {
        window.sessionStorage.removeItem(storageKey);
        return null;
    }
}

function storeLyrics(storageKey: string, lyrics: LyricsResult) {
    window.sessionStorage.setItem(storageKey, JSON.stringify(lyrics));
}

function waitForDuration() {
    if (!player.isLoading && player.duration > 0) {
        return Promise.resolve(player.duration);
    }

    const songId = player.currentSongId;
    const sourceType = player.currentSourceType;

    return new Promise<number | null>((resolve) => {
        const unsubscribe = player.subscribe(() => {
            if (
                player.currentSongId !== songId ||
                player.currentSourceType !== sourceType
            ) {
                unsubscribe();
                resolve(null);
                return;
            }

            if (!player.isLoading && player.duration > 0) {
                const duration = player.duration;
                unsubscribe();
                resolve(duration);
            }
        });
    });
}

async function getLyrics() {
    const currentSong = await currentQueueSong();

    if (!currentSong) return null;
    if (!currentSong.metadata?.title) return null;

    const currentSongDuration = await waitForDuration();

    if (!currentSongDuration) return null;

    const storageKey = getLyricsStorageKey(
        currentSong.metadata.title,
        currentSong.metadata.artist || null,
        currentSong.metadata.album || null,
        currentSongDuration
    );

    const storedLyrics = readStoredLyrics(storageKey);

    if (storedLyrics) return storedLyrics;

    let syncedLyrics = null;
    let plainLyrics = null;

    if (!currentSong.metadata.album || !currentSong.metadata.artist) {
        const lyricsResponse = await search(
            currentSong.metadata.title,
            currentSong.metadata.artist || null,
            currentSong.metadata.album || null,
            currentSongDuration
        );

        syncedLyrics = lyricsResponse?.syncedLyrics || null;
        plainLyrics = lyricsResponse?.plainLyrics || null;
    } else {
        const lyricsResponse = await getExactLyrics(
            currentSong.metadata.title,
            currentSong.metadata.artist,
            currentSong.metadata.album,
            currentSongDuration
        );

        syncedLyrics = lyricsResponse?.syncedLyrics || null;
        plainLyrics = lyricsResponse?.plainLyrics || null;
    }

    const lyrics = {
        syncedLyrics,
        plainLyrics,
    };

    storeLyrics(storageKey, lyrics);

    return lyrics;
}

export default getLyrics;