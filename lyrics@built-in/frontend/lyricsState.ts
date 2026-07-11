import { emit, on } from '@omniplayr/plugins';

const LYRICS_VISIBLE_STORAGE_KEY = 'lyrics@built-in:lyrics-visible';
const QUEUE_VISIBLE_STORAGE_KEY = 'queued@built-in:queue-visible';
const SIDETAB_WIDTH_STORAGE_KEY = 'sidetab:width';
const SIDETAB_ACTIVE_STORAGE_KEY = 'sidetab:active';
const SIDETAB_SWITCHING_CLASS = 'sidetab-switching';
const SIDETAB_DEFAULT_WIDTH = 300;
const SIDETAB_MIN_WIDTH = 300;

const lyricsVisibleListeners = new Set<(visible: boolean) => void>();
const sideTabWidthListeners = new Set<(width: number) => void>();
let openSideTab = null as { id: string; open: boolean } | null;
let sideTabWidth = null as number | null;

function readStoredLyricsVisible() {
    return window.localStorage.getItem(LYRICS_VISIBLE_STORAGE_KEY) === 'true';
}

function readStoredQueueVisible() {
    return window.localStorage.getItem(QUEUE_VISIBLE_STORAGE_KEY) !== 'false';
}

function readActiveSideTabId() {
    const active = window.localStorage.getItem(SIDETAB_ACTIVE_STORAGE_KEY);
    if (active) return active;
    if (readStoredLyricsVisible()) return 'lyrics';
    if (readStoredQueueVisible()) return 'queue';
    return null;
}

function markImmediateSideTabSwitch() {
    document.body.classList.add(SIDETAB_SWITCHING_CLASS);
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            document.body.classList.remove(SIDETAB_SWITCHING_CLASS);
        });
    });
}

export function getLyricsVisibleState() {
    return readStoredLyricsVisible();
}

export function readStoredSideTabWidth() {
    const stored = window.localStorage.getItem(SIDETAB_WIDTH_STORAGE_KEY);
    const value = stored ? Number.parseInt(stored, 10) : SIDETAB_DEFAULT_WIDTH;
    return Number.isFinite(value) ? Math.max(SIDETAB_MIN_WIDTH, value) : SIDETAB_DEFAULT_WIDTH;
}

function updateSideTabWidth(width: number) {
    const next = Math.max(SIDETAB_MIN_WIDTH, Math.round(width));
    if (sideTabWidth === next) return next;
    sideTabWidth = next;
    window.localStorage.setItem(SIDETAB_WIDTH_STORAGE_KEY, String(next));
    sideTabWidthListeners.forEach((listener) => listener(next));
    return next;
}

export function setSideTabWidth(width: number) {
    const next = updateSideTabWidth(width);
    emit('sidetab:resize', {
        width: next,
    });
    return next;
}

export function subscribeSideTabWidth(listener: (width: number) => void) {
    sideTabWidthListeners.add(listener);
    return () => {
        sideTabWidthListeners.delete(listener);
    };
}

function updateLyricsVisibleState(visible: boolean) {
    if (getLyricsVisibleState() === visible) return visible;
    window.localStorage.setItem(LYRICS_VISIBLE_STORAGE_KEY, String(visible));
    lyricsVisibleListeners.forEach((listener) => listener(visible));
    return visible;
}

export function setLyricsVisibleState(visible: boolean) {
    emit('sidetab:toggle', {
        id: 'lyrics',
        open: visible,
    });
    return updateLyricsVisibleState(visible);
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

on('sidetab:toggle', (payload: { id: string; open: boolean }) => {
    if (payload.open) {
        const activeSideTabId = readActiveSideTabId();
        if (activeSideTabId && activeSideTabId !== payload.id) {
            markImmediateSideTabSwitch();
        }
        window.localStorage.setItem(SIDETAB_ACTIVE_STORAGE_KEY, payload.id);

        const previousSideTab = openSideTab;
        openSideTab = payload;

        if (previousSideTab && previousSideTab.id !== payload.id) {
            emit('sidetab:toggle', {
                id: previousSideTab.id,
                open: false,
            });
        }
    } else {
        if (window.localStorage.getItem(SIDETAB_ACTIVE_STORAGE_KEY) === payload.id) {
            window.localStorage.removeItem(SIDETAB_ACTIVE_STORAGE_KEY);
        }

        if (openSideTab?.id === payload.id) {
            openSideTab = null;
        }
    }

    if (payload.open && payload.id !== 'lyrics') {
        updateLyricsVisibleState(false);
        return;
    }

    if (payload.id === 'lyrics') {
        updateLyricsVisibleState(payload.open);
    }
});

on('sidetab:resize', (payload: { width: number }) => {
    if (Number.isFinite(payload.width)) {
        updateSideTabWidth(payload.width);
    }
});
