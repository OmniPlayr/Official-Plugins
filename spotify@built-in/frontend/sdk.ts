import { getValidToken } from './auth';
import api from '../../modules/api';

declare global {
    interface Window {
        Spotify: {
            Player: new (options: {
                name: string;
                getOAuthToken: (cb: (token: string) => void) => void | Promise<void>;
                volume: number;
            }) => SpotifyPlayer;
        };
        sdkPlayer?: SpotifyPlayer;
        onSpotifyWebPlaybackSDKReady: () => void;
    }
}

export interface SpotifyTrack {
    id: string;
    name: string;
    artists: { name: string }[];
    album: {
        name: string;
        images: { url?: string }[];
    };
}

export interface SpotifyState {
    track_window?: {
        current_track?: SpotifyTrack;
    };
    duration: number;
    position: number;
    paused: boolean;
}

export interface SpotifyPlayer {
    addListener(event: 'ready', cb: (payload: { device_id: string }) => void): void;
    addListener(event: 'not_ready', cb: () => void): void;
    addListener(
        event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
        cb: (payload: { message: string }) => void
    ): void;
    addListener(event: 'autoplay_failed', cb: () => void): void;
    addListener(event: 'player_state_changed', cb: (state: SpotifyState | null) => void): void;
    connect(): Promise<boolean>;
    activateElement(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    seek(ms: number): Promise<void>;
    setVolume(fraction: number): Promise<void>;
    getVolume(): Promise<number>;
    disconnect(): void;
}

type StateListener = (state: SpotifyState | null) => void;

let sdkPlayer: SpotifyPlayer | null = null;
let deviceId: string | null = null;
let currentState: SpotifyState | null = null;
const stateListeners = new Set<StateListener>();
let readyResolve: (() => void) | null = null;
let readyPromise = new Promise<void>(r => { readyResolve = r; });
let volumeInterval: ReturnType<typeof setInterval> | null = null;
let sdkLoadStarted = false;

function spotifyConsoleError(message: string, error?: unknown) {
    if (error) {
        console.error(`[spotify@built-in] ${message}`, error);
    } else {
        console.error(`[spotify@built-in] ${message}`);
    }
}

async function loadAccount(): Promise<{ name?: string } | null> {
    const account = await api("get_account", undefined, { account_id: "me" });

    if (account && typeof account === 'object' && 'name' in account) {
        return account as { name?: string };
    }

    return null;
}

function resetReady() {
    readyPromise = new Promise<void>(r => { readyResolve = r; });
}

function notifyState(state: SpotifyState | null) {
    currentState = state;
    stateListeners.forEach(cb => cb(state));
}

export function onStateChange(cb: StateListener): () => void {
    stateListeners.add(cb);
    return () => stateListeners.delete(cb);
}

export function getState() { return currentState; }
export function getDeviceId() { return deviceId; }
export function waitReady() { return readyPromise; }

export async function loadSdk(): Promise<boolean> {
    if (document.getElementById('spotify-sdk')) return true;
    const account = await loadAccount();
    const name = account?.name;

    if (
        window.location.protocol === 'http:' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1'
    ) {
        spotifyConsoleError('Spotify SDK is unavailable because this page is not using HTTPS.');
        return false;
    } else if (
        window.location.protocol === 'http:' &&
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ) {
        console.warn('[spotify@built-in] Running on localhost over HTTP is allowed, but Spotify features may still require HTTPS in production.');
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
        sdkPlayer = new window.Spotify.Player({
            name: 'OmniPlayr • ' + name,
            getOAuthToken: async (cb: (t: string) => void) => {
                const t = await getValidToken();
                if (t) cb(t);
            },
            volume: 1,
        });
        window.sdkPlayer = sdkPlayer;

        sdkPlayer.addListener('ready', ({ device_id }: { device_id: string }) => {
            deviceId = device_id;
            readyResolve?.();
        });

        sdkPlayer.addListener('not_ready', () => {
            spotifyConsoleError('Spotify Web Playback SDK device became unavailable.');
            deviceId = null;
            resetReady();
        });

        sdkPlayer.addListener('initialization_error', ({ message }: { message: string }) => {
            spotifyConsoleError(`Spotify SDK initialization failed: ${message}`);
        });

        sdkPlayer.addListener('authentication_error', ({ message }: { message: string }) => {
            spotifyConsoleError(`Spotify SDK authentication failed: ${message}`);
        });

        sdkPlayer.addListener('account_error', ({ message }: { message: string }) => {
            spotifyConsoleError(`Spotify SDK account error: ${message}`);
        });

        sdkPlayer.addListener('playback_error', ({ message }: { message: string }) => {
            spotifyConsoleError(`Spotify SDK playback error: ${message}`);
        });

        sdkPlayer.addListener('autoplay_failed', () => {
            spotifyConsoleError('Spotify autoplay was blocked by the browser.');
        });

        sdkPlayer.addListener('player_state_changed', notifyState);

        sdkPlayer.connect();
    };

    sdkLoadStarted = true;
    const script = document.createElement('script');
    script.id = 'spotify-sdk';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.onerror = () => {
        sdkLoadStarted = false;
        spotifyConsoleError('Spotify Web Playback SDK script failed to load.');
    };
    document.head.appendChild(script);

    return true;
}

export function isSdkLoadStarted() { return sdkLoadStarted; }

export async function sdkPlay(trackId: string) {
    await waitReady();
    const token = await getValidToken();
    if (!token || !deviceId || !sdkPlayer) throw new Error('Spotify not ready');

    await sdkPlayer.activateElement();

    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    });

    if (!res.ok && res.status !== 204) {
        let details = '';
        try {
            details = await res.text();
        } catch {
            details = '';
        }

        throw new Error(`Spotify play failed: ${res.status}${details ? ` ${details}` : ''}`);
    }
}

export async function sdkPause() { await sdkPlayer?.pause(); }

export async function sdkResume() {
    await sdkPlayer?.activateElement();
    await sdkPlayer?.resume();
}

export async function sdkSeek(ms: number) { await sdkPlayer?.seek(ms); }
export async function sdkSetVolume(fraction: number) { await sdkPlayer?.setVolume(fraction); }
export function sdkActivateElement() { return sdkPlayer?.activateElement(); }

export function startVolumePolling(onChange: (v: number) => void, sdkPlayer: SpotifyPlayer | null | undefined) {
    if (volumeInterval || !sdkPlayer) return;

    let last = -1;

    volumeInterval = setInterval(async () => {
        const v = await sdkPlayer.getVolume();

        if (v !== last) {
            last = v;
            onChange(v);
        }
    }, 1000);
}

export function stopVolumePolling() {
    if (volumeInterval) {
        clearInterval(volumeInterval);
        volumeInterval = null;
    }
}
export function sdkDisconnect() {
    sdkPlayer?.disconnect();
    sdkPlayer = null;
    deviceId = null;
    currentState = null;
    resetReady();
}
