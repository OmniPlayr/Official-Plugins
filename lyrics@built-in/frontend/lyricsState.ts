const LYRICS_VISIBLE_STORAGE_KEY = 'lyrics@built-in:lyrics-visible';

const lyricsVisibleListeners = new Set<(visible: boolean) => void>();

export function getLyricsVisibleState() {
    return window.localStorage.getItem(LYRICS_VISIBLE_STORAGE_KEY) === 'true';
}

export function setLyricsVisibleState(visible: boolean) {
    if (getLyricsVisibleState() === visible) return visible;
    window.localStorage.setItem(LYRICS_VISIBLE_STORAGE_KEY, String(visible));
    lyricsVisibleListeners.forEach((listener) => listener(visible));
    return visible;
}

export function toggleLyricsVisibleState() {
    return setLyricsVisibleState(!getLyricsVisibleState());
}

export function subscribeLyricsVisibleState(listener: (visible: boolean) => void) {
    lyricsVisibleListeners.add(listener);
    return () => {
        lyricsVisibleListeners.delete(listener);
    };
}