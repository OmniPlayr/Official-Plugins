import { emit, on } from '@omniplayr/plugins';
import { QUEUE_DEFAULT_WIDTH, QUEUE_MIN_WIDTH, QUEUE_VISIBLE_STORAGE_KEY, QUEUE_WIDTH_STORAGE_KEY } from './constants';

const queueVisibleListeners = new Set<(visible: boolean) => void>();
const sideTabWidthListeners = new Set<(width: number) => void>();
const SIDETAB_WIDTH_STORAGE_KEY = 'sidetab:width';
const SIDETAB_ACTIVE_STORAGE_KEY = 'sidetab:active';
const SIDETAB_TRANSITION_STORAGE_KEY = 'sidetab:transition';
const SIDETAB_SWITCHING_CLASS = 'sidetab-switching';
const LYRICS_VISIBLE_STORAGE_KEY = 'lyrics@built-in:lyrics-visible';
const DEVICES_VISIBLE_STORAGE_KEY = 'devices@built-in:devices-visible';
let openSideTab = null as { id: string; open: boolean } | null;
let sideTabWidth = null as number | null;

export function readStoredQueueWidth() {
    const stored = window.localStorage.getItem(SIDETAB_WIDTH_STORAGE_KEY)
        ?? window.localStorage.getItem(QUEUE_WIDTH_STORAGE_KEY);
    const value = stored ? Number.parseInt(stored, 10) : QUEUE_DEFAULT_WIDTH;
    return Number.isFinite(value) ? Math.max(QUEUE_MIN_WIDTH, value) : QUEUE_DEFAULT_WIDTH;
}

function updateSideTabWidth(width: number) {
    const next = Math.max(QUEUE_MIN_WIDTH, Math.round(width));
    if (sideTabWidth === next) return next;
    sideTabWidth = next;
    window.localStorage.setItem(SIDETAB_WIDTH_STORAGE_KEY, String(next));
    window.localStorage.setItem(QUEUE_WIDTH_STORAGE_KEY, String(next));
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

function readStoredQueueVisible() {
    return window.localStorage.getItem(QUEUE_VISIBLE_STORAGE_KEY) !== 'false';
}

function readActiveSideTabId() {
    const active = window.localStorage.getItem(SIDETAB_ACTIVE_STORAGE_KEY);
    if (active) return active;
    if (window.localStorage.getItem(LYRICS_VISIBLE_STORAGE_KEY) === 'true') return 'lyrics';
    if (window.localStorage.getItem(DEVICES_VISIBLE_STORAGE_KEY) === 'true') return 'devices';
    if (readStoredQueueVisible()) return 'queue';
    return null;
}

function writeSideTabTransition(type: 'open' | 'close' | 'switch', from: string | null, to: string | null) {
    if (type !== 'switch') {
        try {
            const current = JSON.parse(window.sessionStorage.getItem(SIDETAB_TRANSITION_STORAGE_KEY) ?? 'null') as {
                type?: string;
                from?: string | null;
                to?: string | null;
                expiresAt?: number;
            } | null;
            if (
                current?.type === 'switch' &&
                typeof current.expiresAt === 'number' &&
                current.expiresAt >= Date.now() &&
                (current.from === from || current.to === to)
            ) {
                return;
            }
        } catch {

        }
    }

    window.sessionStorage.setItem(SIDETAB_TRANSITION_STORAGE_KEY, JSON.stringify({
        type,
        from,
        to,
        expiresAt: Date.now() + 1500,
    }));
}

function markImmediateSideTabSwitch(from: string, to: string) {
    writeSideTabTransition('switch', from, to);
    document.body.classList.add(SIDETAB_SWITCHING_CLASS);
    window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
            document.body.classList.remove(SIDETAB_SWITCHING_CLASS);
        });
    });
}

export function getQueueVisibleState() {
    return readStoredQueueVisible();
}

function updateQueueVisibleState(visible: boolean) {
    if (getQueueVisibleState() === visible) return visible;
    window.localStorage.setItem(QUEUE_VISIBLE_STORAGE_KEY, String(visible));
    queueVisibleListeners.forEach((listener) => listener(visible));
    return visible;
}

export function setQueueVisibleState(visible: boolean) {
    if (visible) {
        const activeSideTabId = readActiveSideTabId();
        if (activeSideTabId && activeSideTabId !== 'queue') {
            markImmediateSideTabSwitch(activeSideTabId, 'queue');
        } else {
            writeSideTabTransition('open', null, 'queue');
        }
        window.localStorage.setItem(SIDETAB_ACTIVE_STORAGE_KEY, 'queue');
        updateQueueVisibleState(true);
    }

    emit('sidetab:toggle', {
        id: 'queue',
        open: visible,
    });

    if (!visible) {
        return updateQueueVisibleState(false);
    }

    return updateQueueVisibleState(visible);
}

export function toggleQueueVisibleState() {
    return setQueueVisibleState(!getQueueVisibleState());
}

export function subscribeQueueVisibleState(listener: (visible: boolean) => void) {
    queueVisibleListeners.add(listener);
    return () => {
        queueVisibleListeners.delete(listener);
    };
}

on('sidetab:toggle', (payload: { id: string; open: boolean }) => {
    if (payload.open) {
        const activeSideTabId = readActiveSideTabId();
        if (activeSideTabId && activeSideTabId !== payload.id) {
            markImmediateSideTabSwitch(activeSideTabId, payload.id);
        } else {
            writeSideTabTransition('open', null, payload.id);
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
            writeSideTabTransition('close', payload.id, null);
            window.localStorage.removeItem(SIDETAB_ACTIVE_STORAGE_KEY);
        }

        if (openSideTab?.id === payload.id) {
            openSideTab = null;
        }
    }

    if (payload.open && payload.id !== 'queue') {
        updateQueueVisibleState(false);
        return;
    }

    if (payload.id === 'queue') {
        updateQueueVisibleState(payload.open);
    }
});

on('sidetab:resize', (payload: { width: number }) => {
    if (Number.isFinite(payload.width)) {
        updateSideTabWidth(payload.width);
    }
});
