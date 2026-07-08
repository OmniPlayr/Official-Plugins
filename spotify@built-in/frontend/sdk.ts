import { getValidToken } from './auth';
import { api } from '@omniplayr/plugins';

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
let lastPlaybackErrorMessage: string | null = null;
let lastPlaybackErrorAt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let diagnosticsInFlight = false;
let reconnectAttempts = 0;
let reconnectPromise: Promise<void> | null = null;

function spotifyConsoleError(message: string, error?: unknown) {
    if (error) {
        console.error(`[spotify@built-in] ${message}`, error);
    } else {
        console.error(`[spotify@built-in] ${message}`);
    }
}

function spotifyConsoleWarn(message: string, error?: unknown) {
    if (error) {
        console.warn(`[spotify@built-in] ${message}`, error);
    } else {
        console.warn(`[spotify@built-in] ${message}`);
    }
}

function describePlaybackError(message: string) {
    if (message.toLowerCase() !== 'playback error') return message;

    return 'Spotify reported a generic SDK playback error.';
}

function formatDevice(device: Record<string, unknown> | null | undefined) {
    if (!device) return 'none';

    const name = typeof device.name === 'string' ? device.name : 'unknown device';
    const type = typeof device.type === 'string' ? device.type : 'unknown type';
    const active = device.is_active === true ? 'active' : 'inactive';
    const restricted = device.is_restricted === true ? ', restricted' : '';
    const volume = typeof device.volume_percent === 'number' ? `, volume ${device.volume_percent}%` : '';

    return `${name} (${type}, ${active}${restricted}${volume})`;
}

async function getSpotifyJson(path: string, token: string) {
    const res = await fetch(`https://api.spotify.com/v1${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 204) return null;

    let body: unknown = null;
    try {
        body = await res.json();
    } catch {
        body = null;
    }

    return { ok: res.ok, status: res.status, body };
}

type SpotifyCommandPath = string | ((currentDeviceId: string) => string);
type SpotifyCommandBody = unknown | ((currentDeviceId: string) => unknown);

function resolveCommandValue<T>(value: T | ((currentDeviceId: string) => T), currentDeviceId: string): T {
    return typeof value === 'function'
        ? (value as (currentDeviceId: string) => T)(currentDeviceId)
        : value;
}

function isDeviceNotFound(status: number, details: string) {
    return status === 404 && /device not found/i.test(details);
}

async function putSpotifyCommand(path: SpotifyCommandPath, errorLabel: string, body?: SpotifyCommandBody) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
        await waitReady();

        const token = await getValidToken();
        const targetDeviceId = deviceId;

        if (!token || !targetDeviceId) {
            if (attempt === 0) {
                await reconnectNow();
                continue;
            }

            throw new Error('Spotify not ready');
        }

        const resolvedPath = resolveCommandValue(path, targetDeviceId);
        const resolvedBody = body === undefined ? undefined : resolveCommandValue(body, targetDeviceId);

        const res = await fetch(`https://api.spotify.com/v1${resolvedPath}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                ...(resolvedBody === undefined ? {} : { 'Content-Type': 'application/json' }),
            },
            body: resolvedBody === undefined ? undefined : JSON.stringify(resolvedBody),
        });

        if (res.ok || res.status === 204) return;

        let details = '';
        try {
            details = await res.text();
        } catch {
            details = '';
        }

        if (attempt === 0 && isDeviceNotFound(res.status, details)) {
            spotifyConsoleWarn('Spotify browser device disappeared; reconnecting the Web Playback SDK and retrying the command.');
            await reconnectNow();
            continue;
        }

        throw new Error(`${errorLabel}: ${res.status}${details ? ` ${details}` : ''}`);
    }
}

async function diagnosePlaybackError(message: string) {
    if (diagnosticsInFlight) return;
    diagnosticsInFlight = true;

    try {
        const token = await getValidToken();
        const details: string[] = [];
        const isGenericPlaybackError = message.toLowerCase() === 'playback error';
        let sdkDevice: Record<string, unknown> | undefined;
        let activeDevice: Record<string, unknown> | undefined;
        let playbackState: {
            is_playing?: boolean;
            currently_playing_type?: string;
            device?: Record<string, unknown>;
        } | null = null;

        details.push(describePlaybackError(message));
        details.push(`SDK device id: ${deviceId ?? 'not ready'}`);
        details.push(`Page visibility: ${document.visibilityState}`);

        if (!token) {
            details.push('Spotify token is unavailable or expired.');
            spotifyConsoleWarn(`Spotify playback failed: ${details.join(' ')}`);
            return;
        }

        const [devicesResult, playerResult] = await Promise.all([
            getSpotifyJson('/me/player/devices', token),
            getSpotifyJson('/me/player', token),
        ]);

        if (devicesResult && !devicesResult.ok) {
            details.push(`Device lookup failed with Spotify API status ${devicesResult.status}.`);
        } else if (devicesResult?.body && typeof devicesResult.body === 'object') {
            const devices = Array.isArray((devicesResult.body as { devices?: unknown }).devices)
                ? (devicesResult.body as { devices: Record<string, unknown>[] }).devices
                : [];
            sdkDevice = devices.find(device => device.id === deviceId);
            activeDevice = devices.find(device => device.is_active === true);

            details.push(`SDK device: ${formatDevice(sdkDevice)}.`);
            details.push(`Active Spotify device: ${formatDevice(activeDevice)}.`);

            if (!sdkDevice) {
                details.push('The browser player is not listed as an available Spotify device.');
            } else if (sdkDevice.is_restricted === true) {
                details.push('Spotify marked the browser player as restricted.');
            } else if (!activeDevice || activeDevice.id !== deviceId) {
                details.push('Spotify is not currently playing through the browser SDK device.');
            }
        }

        if (playerResult === null) {
            details.push('Spotify reports no active playback session.');
        } else if (playerResult && !playerResult.ok) {
            details.push(`Playback-state lookup failed with Spotify API status ${playerResult.status}.`);
        } else if (playerResult?.body && typeof playerResult.body === 'object') {
            const body = playerResult.body as {
                is_playing?: boolean;
                currently_playing_type?: string;
                device?: Record<string, unknown>;
            };
            playbackState = body;

            details.push(`Spotify playback state: ${body.is_playing ? 'playing' : 'paused/stopped'} ${body.currently_playing_type ?? 'unknown item'}.`);
            details.push(`Spotify playback device: ${formatDevice(body.device)}.`);
        }

        if (
            isGenericPlaybackError &&
            sdkDevice &&
            activeDevice?.id === deviceId &&
            playbackState?.is_playing === false
        ) {
            details.unshift(
                'Likely cause: Chrome/Edge could not open or keep the selected Windows audio output device for Spotify Web Playback. ' +
                'Spotify accepted the OmniPlayr browser device, then playback immediately stopped before audio started. ' +
                'Check the Windows output device, Bluetooth/headset disconnects, exclusive-mode audio settings, sample-rate changes, or restart the browser audio service/browser.'
            );
        } else if (isGenericPlaybackError && !sdkDevice) {
            details.unshift('Likely cause: the Spotify browser player disappeared from available devices before playback could start.');
        } else if (isGenericPlaybackError && activeDevice?.id !== deviceId) {
            details.unshift('Likely cause: Spotify moved playback to another device instead of the OmniPlayr browser player.');
        }

        spotifyConsoleWarn(`Spotify playback failed: ${details.join(' ')}`);
    } catch (error) {
        spotifyConsoleWarn(`Spotify playback failed: ${describePlaybackError(message)} Diagnostics failed.`, error);
    } finally {
        diagnosticsInFlight = false;
    }
}

function attachPlayerListeners(player: SpotifyPlayer) {
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
        reconnectAttempts = 0;
        deviceId = device_id;
        readyResolve?.();
    });

    player.addListener('not_ready', () => {
        spotifyConsoleError('Spotify Web Playback SDK device became unavailable.');
        deviceId = null;
        currentState = null;
        resetReady();
        scheduleReconnect();
    });

    player.addListener('initialization_error', ({ message }: { message: string }) => {
        spotifyConsoleError(`Spotify SDK initialization failed: ${message}`);
    });

    player.addListener('authentication_error', ({ message }: { message: string }) => {
        spotifyConsoleError(`Spotify SDK authentication failed: ${message}`);
    });

    player.addListener('account_error', ({ message }: { message: string }) => {
        spotifyConsoleError(`Spotify SDK account error: ${message}`);
    });

    player.addListener('playback_error', ({ message }: { message: string }) => {
        const text = message || 'Playback error';
        const now = Date.now();
        const isDuplicate = text === lastPlaybackErrorMessage && now - lastPlaybackErrorAt < 30000;

        lastPlaybackErrorMessage = text;
        lastPlaybackErrorAt = now;

        if (!isDuplicate) diagnosePlaybackError(text);

        if (text.toLowerCase() === 'playback error') {
            scheduleReconnect();
        }
    });

    player.addListener('autoplay_failed', () => {
        spotifyConsoleError('Spotify autoplay was blocked by the browser.');
    });

    player.addListener('player_state_changed', notifyState);
}

async function createAndConnectPlayer(name?: string) {
    if (!window.Spotify?.Player) throw new Error('Spotify Web Playback SDK is not loaded');

    const previous = sdkPlayer;
    if (previous) {
        try {
            previous.disconnect();
        } catch (error) {
            spotifyConsoleWarn('Spotify Web Playback SDK disconnect failed during reconnect.', error);
        }
    }

    deviceId = null;
    currentState = null;
    resetReady();

    sdkPlayer = new window.Spotify.Player({
        name: 'OmniPlayr - ' + (name || 'Spotify'),
        getOAuthToken: async (cb: (t: string) => void) => {
            const t = await getValidToken();
            if (t) cb(t);
        },
        volume: 1,
    });
    window.sdkPlayer = sdkPlayer;
    attachPlayerListeners(sdkPlayer);

    const connected = await sdkPlayer.connect();
    if (!connected) throw new Error('Spotify Web Playback SDK connection was rejected');
}

async function reconnectNow() {
    if (reconnectPromise) return reconnectPromise;

    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    reconnectPromise = (async () => {
        reconnectAttempts += 1;
        const account = await loadAccount();
        await createAndConnectPlayer(account?.name);
        await waitReady();
    })().finally(() => {
        reconnectPromise = null;
    });

    return reconnectPromise;
}

function scheduleReconnect() {
    if (reconnectTimer || !window.Spotify?.Player) return;

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;

        try {
            await reconnectNow();
        } catch (error) {
            spotifyConsoleWarn('Spotify Web Playback SDK reconnect failed.', error);
            if (reconnectAttempts < 3) scheduleReconnect();
        }
    }, 1500);
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
    stateListeners.forEach(cb => {
        try {
            cb(state);
        } catch (error) {
            spotifyConsoleWarn('Spotify playback state listener failed.', error);
        }
    });
}

export function onStateChange(cb: StateListener): () => void {
    stateListeners.add(cb);
    return () => stateListeners.delete(cb);
}

export function getState() { return currentState; }
export function getDeviceId() { return deviceId; }
export function waitReady() {
    if (sdkPlayer && deviceId) return Promise.resolve();
    return readyPromise;
}

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
        createAndConnectPlayer(name).catch(error => {
            spotifyConsoleError('Spotify Web Playback SDK failed to connect.', error);
        });
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
    await putSpotifyCommand('/me/player', 'Spotify device transfer failed', currentDeviceId => ({
        device_ids: [currentDeviceId],
        play: false,
    }));
    await putSpotifyCommand(
        currentDeviceId => `/me/player/play?device_id=${encodeURIComponent(currentDeviceId)}`,
        'Spotify play failed',
        { uris: [`spotify:track:${trackId}`] }
    );
}

export async function sdkPause() {
    await putSpotifyCommand(
        currentDeviceId => `/me/player/pause?device_id=${encodeURIComponent(currentDeviceId)}`,
        'Spotify pause failed'
    );
}

export async function sdkResume() {
    await putSpotifyCommand(
        currentDeviceId => `/me/player/play?device_id=${encodeURIComponent(currentDeviceId)}`,
        'Spotify resume failed'
    );
}

export async function sdkSeek(ms: number) {
    await putSpotifyCommand(
        currentDeviceId => `/me/player/seek?position_ms=${Math.max(0, Math.floor(ms))}&device_id=${encodeURIComponent(currentDeviceId)}`,
        'Spotify seek failed'
    );
}
export function sdkActivateElement() { return sdkPlayer?.activateElement(); }

export async function sdkSetVolume(fraction: number) {
    const volumePercent = Math.max(0, Math.min(100, Math.round(fraction * 100)));
    await putSpotifyCommand(
        currentDeviceId => `/me/player/volume?volume_percent=${volumePercent}&device_id=${encodeURIComponent(currentDeviceId)}`,
        'Spotify volume update failed'
    );
}

async function sdkGetVolume(): Promise<number | null> {
    const token = await getValidToken();
    if (!token || !deviceId) return null;

    const devicesResult = await getSpotifyJson('/me/player/devices', token);
    if (!devicesResult?.ok || !devicesResult.body || typeof devicesResult.body !== 'object') return null;

    const devices = Array.isArray((devicesResult.body as { devices?: unknown }).devices)
        ? (devicesResult.body as { devices: Record<string, unknown>[] }).devices
        : [];
    const sdkDevice = devices.find(device => device.id === deviceId);
    const volumePercent = sdkDevice?.volume_percent;

    return typeof volumePercent === 'number'
        ? Math.max(0, Math.min(1, volumePercent / 100))
        : null;
}

export function startVolumePolling(onChange: (v: number) => void | Promise<void>) {
    if (volumeInterval) return;

    let last = -1;

    volumeInterval = setInterval(async () => {
        let v: number | null;
        try {
            v = await sdkGetVolume();
        } catch (error) {
            spotifyConsoleWarn('Spotify volume polling failed.', error);
            return;
        }

        if (v === null) return;

        if (v !== last) {
            last = v;
            try {
                Promise.resolve(onChange(v)).catch(error => {
                    spotifyConsoleWarn('Spotify volume change listener failed.', error);
                });
            } catch (error) {
                spotifyConsoleWarn('Spotify volume change listener failed.', error);
            }
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
