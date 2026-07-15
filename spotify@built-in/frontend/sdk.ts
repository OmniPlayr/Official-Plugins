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
    setVolume(fraction: number): Promise<void>;
    disconnect(): void;
}

type StateListener = (state: SpotifyState | null) => void;
type SpotifyApiDevice = Record<string, unknown> & {
    id?: string | null;
    is_active?: boolean;
    is_restricted?: boolean;
};

let sdkPlayer: SpotifyPlayer | null = null;
let deviceId: string | null = null;
let currentState: SpotifyState | null = null;
const stateListeners = new Set<StateListener>();
let readyResolve: (() => void) | null = null;
let readyPromise = new Promise<void>(r => { readyResolve = r; });
let sdkLoadStarted = false;
let sdkInitPromise: Promise<boolean> | null = null;
let sdkScriptPromise: Promise<void> | null = null;
let lastSdkSetupError: string | null = null;
let lastPlaybackErrorMessage: string | null = null;
let lastPlaybackErrorAt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let playbackErrorDiagnosticTimer: ReturnType<typeof setTimeout> | null = null;
let diagnosticsInFlight = false;
let playbackCommandInFlight = 0;
let intentionalDisconnectInFlight = false;
let gestureActivationListenersInstalled = false;
let lastGestureActivationErrorAt = 0;

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

function activateCurrentPlayerFromGesture() {
    const player = sdkPlayer;
    if (!player) return;

    try {
        void player.activateElement().catch(error => {
            const now = Date.now();
            if (now - lastGestureActivationErrorAt < 10000) return;
            lastGestureActivationErrorAt = now;
            spotifyConsoleWarn('Spotify player could not be primed from this browser gesture.', error);
        });
    } catch (error) {
        const now = Date.now();
        if (now - lastGestureActivationErrorAt < 10000) return;
        lastGestureActivationErrorAt = now;
        spotifyConsoleWarn('Spotify player could not be primed from this browser gesture.', error);
    }
}

function installGestureActivationListeners() {
    if (gestureActivationListenersInstalled || typeof document === 'undefined') return;

    gestureActivationListenersInstalled = true;
    document.addEventListener('pointerdown', activateCurrentPlayerFromGesture, { capture: true, passive: true });
    document.addEventListener('touchstart', activateCurrentPlayerFromGesture, { capture: true, passive: true });
    document.addEventListener('keydown', activateCurrentPlayerFromGesture, { capture: true });
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

async function readSpotifyError(res: Response) {
    try {
        return await res.text();
    } catch {
        return '';
    }
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function reportPlaybackIssue(message: string, error?: unknown) {
    const now = Date.now();
    const isDuplicate = message === lastPlaybackErrorMessage && now - lastPlaybackErrorAt < 30000;
    lastPlaybackErrorMessage = message;
    lastPlaybackErrorAt = now;

    if (!isDuplicate) spotifyConsoleWarn(message, error);
}

function makeSpotifyActionError(action: string, error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return new Error(
        `Spotify could not ${action} in OmniPlayr. ` +
        `Make sure the Spotify account is Premium, click play from OmniPlayr once, keep this browser tab open, and try again. ` +
        `Details: ${detail}`
    );
}

async function getSpotifyDevices(token: string): Promise<SpotifyApiDevice[]> {
    const devicesResult = await getSpotifyJson('/me/player/devices', token);

    if (!devicesResult || !devicesResult.ok || !devicesResult.body || typeof devicesResult.body !== 'object') {
        return [];
    }

    const devices = (devicesResult.body as { devices?: unknown }).devices;
    return Array.isArray(devices) ? devices as SpotifyApiDevice[] : [];
}

async function getActiveSpotifyDeviceId(token: string) {
    const devices = await getSpotifyDevices(token);
    return devices.find(device => device.is_active === true)?.id ?? null;
}

async function waitForActiveSpotifyDevice(token: string, targetDeviceId: string, timeoutMs = 2500) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        const activeDeviceId = await getActiveSpotifyDeviceId(token);
        if (activeDeviceId === targetDeviceId) return true;
        await sleep(250);
    }

    return false;
}

async function playTrackOnDevice(token: string, targetDeviceId: string, trackId: string) {
    const res = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDeviceId)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ uris: [`spotify:track:${trackId}`] }),
    });

    if (res.ok || res.status === 204) return;

    const details = await readSpotifyError(res);
    throw new Error(`Spotify play failed: ${res.status}${details ? ` ${details}` : ''}`);
}

async function putSpotifyCommand(
    path: string,
    errorLabel: string,
    options: { ignoreMissingDevice?: boolean; reconnectOnMissingDevice?: boolean } = {}
) {
    const targetDeviceId = deviceId;
    if (!targetDeviceId) return;

    const token = await getValidToken();
    if (!token) throw new Error('Spotify token is unavailable');

    const separator = path.includes('?') ? '&' : '?';
    const res = await fetch(
        `https://api.spotify.com/v1${path}${separator}device_id=${encodeURIComponent(targetDeviceId)}`,
        {
            method: 'PUT',
            headers: { Authorization: `Bearer ${token}` },
        }
    );

    if (res.ok || res.status === 204) return;

    if (res.status === 404) {
        deviceId = null;
        notifyState(null);
        resetReady();

        if (options.reconnectOnMissingDevice) {
            await sdkReconnectNow();
            return putSpotifyCommand(path, errorLabel, { ...options, reconnectOnMissingDevice: false });
        }

        if (options.ignoreMissingDevice) return;

        scheduleReconnect();
    }

    const details = await readSpotifyError(res);

    throw new Error(`${errorLabel}: ${res.status}${details ? ` ${details}` : ''}`);
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

function scheduleReconnect(delayMs = 1500) {
    if (reconnectTimer) return;

    reconnectTimer = setTimeout(async () => {
        reconnectTimer = null;

        if (playbackCommandInFlight > 0) {
            scheduleReconnect(3000);
            return;
        }

        try {
            await sdkReconnectNow();
        } catch (error) {
            spotifyConsoleWarn('Spotify Web Playback SDK reconnect failed.', error);
        }
    }, delayMs);
}

async function loadAccount(): Promise<{ name?: string } | null> {
    const account = await api("/accounts/me");

    if (account && typeof account === 'object' && 'name' in account) {
        return account as { name?: string };
    }

    return null;
}

function resetReady() {
    readyPromise = new Promise<void>(r => { readyResolve = r; });
}

async function waitForReadyDevice(timeoutMs = 10000) {
    if (sdkPlayer && deviceId) return;
    await withTimeout(
        readyPromise,
        timeoutMs,
        'Timed out waiting for Spotify Web Playback SDK readiness'
    );
}

async function reconnectExistingPlayer(timeoutMs = 5000) {
    if (!sdkPlayer) return false;

    deviceId = null;
    notifyState(null);
    resetReady();

    const connected = await sdkPlayer.connect();
    if (!connected) return false;

    try {
        await waitForReadyDevice(timeoutMs);
        return true;
    } catch {
        return false;
    }
}

function createSdkScriptPromise() {
    if (window.Spotify?.Player) return Promise.resolve();
    if (sdkScriptPromise) return sdkScriptPromise;

    sdkLoadStarted = true;
    sdkScriptPromise = new Promise<void>((resolve, reject) => {
        const existing = document.getElementById('spotify-sdk') as HTMLScriptElement | null;
        const script = existing ?? document.createElement('script');
        let readyCheck: ReturnType<typeof window.setInterval> | null = null;

        const cleanup = () => {
            window.clearTimeout(timeout);
            if (readyCheck) window.clearInterval(readyCheck);
        };

        const finishIfReady = () => {
            if (!window.Spotify?.Player) return false;
            cleanup();
            resolve();
            return true;
        };

        const waitUntilReady = () => {
            if (finishIfReady() || readyCheck) return;
            readyCheck = window.setInterval(finishIfReady, 50);
        };

        const timeout = window.setTimeout(() => {
            cleanup();
            sdkLoadStarted = false;
            sdkScriptPromise = null;
            if (!window.Spotify?.Player) script.remove();
            reject(new Error('Timed out loading Spotify Web Playback SDK script'));
        }, 10000);

        const fail = () => {
            cleanup();
            sdkLoadStarted = false;
            sdkScriptPromise = null;
            script.remove();
            reject(new Error('Spotify Web Playback SDK script failed to load'));
        };

        const previousReady = window.onSpotifyWebPlaybackSDKReady;
        window.onSpotifyWebPlaybackSDKReady = () => {
            previousReady?.();
            waitUntilReady();
        };

        script.addEventListener('load', waitUntilReady, { once: true });
        script.addEventListener('error', fail, { once: true });

        if (!existing) {
            script.id = 'spotify-sdk';
            script.src = 'https://sdk.scdn.co/spotify-player.js';
            document.head.appendChild(script);
        } else {
            waitUntilReady();
        }
    });

    return sdkScriptPromise;
}

async function initializeSpotifyPlayer() {
    if (sdkPlayer) {
        if (!deviceId) {
            resetReady();
            const connected = await sdkPlayer.connect();
            if (!connected) spotifyConsoleWarn('Spotify Web Playback SDK reconnect was rejected.');
        }

        return true;
    }

    if (!window.Spotify?.Player) return false;
    if (sdkInitPromise) return sdkInitPromise;

    sdkInitPromise = (async () => {
        const account = await loadAccount();
        const name = account?.name;

        sdkPlayer = new window.Spotify.Player({
            name: name ? `OmniPlayr - ${name}` : 'OmniPlayr',
            getOAuthToken: async (cb: (t: string) => void) => {
                const t = await getValidToken();
                if (t) cb(t);
            },
            volume: 1,
        });
        window.sdkPlayer = sdkPlayer;

        sdkPlayer.addListener('ready', ({ device_id }: { device_id: string }) => {
            lastSdkSetupError = null;
            deviceId = device_id;
            readyResolve?.();
        });

        sdkPlayer.addListener('not_ready', () => {
            if (intentionalDisconnectInFlight) return;
            spotifyConsoleError('Spotify Web Playback SDK device became unavailable.');
            deviceId = null;
            notifyState(null);
            resetReady();
            scheduleReconnect();
        });

        sdkPlayer.addListener('initialization_error', ({ message }: { message: string }) => {
            lastSdkSetupError = message;
            spotifyConsoleError(`Spotify SDK initialization failed: ${message}`);
        });

        sdkPlayer.addListener('authentication_error', ({ message }: { message: string }) => {
            lastSdkSetupError = message;
            spotifyConsoleError(`Spotify SDK authentication failed: ${message}`);
        });

        sdkPlayer.addListener('account_error', ({ message }: { message: string }) => {
            lastSdkSetupError = message;
            spotifyConsoleError(`Spotify SDK account error: ${message}`);
        });

        sdkPlayer.addListener('playback_error', ({ message }: { message: string }) => {
            const text = message || 'Playback error';
            const now = Date.now();
            const isDuplicate = text === lastPlaybackErrorMessage && now - lastPlaybackErrorAt < 30000;
            const isGenericPlaybackError = text.toLowerCase() === 'playback error';

            lastPlaybackErrorMessage = text;
            lastPlaybackErrorAt = now;

            if (isGenericPlaybackError) {
                notifyState(null);
                scheduleReconnect();
                if (!isDuplicate) schedulePlaybackErrorDiagnostic(text);
                return;
            }

            if (!isDuplicate) diagnosePlaybackError(text);
        });

        sdkPlayer.addListener('autoplay_failed', () => {
            spotifyConsoleError('Spotify autoplay was blocked by the browser.');
        });

        sdkPlayer.addListener('player_state_changed', notifyState);

        const connected = await sdkPlayer.connect();
        if (!connected) spotifyConsoleWarn('Spotify Web Playback SDK connection was rejected.');

        return connected;
    })().finally(() => {
        sdkInitPromise = null;
    });

    return sdkInitPromise;
}

function notifyState(state: SpotifyState | null) {
    currentState = state;
    if (state && !state.paused && playbackErrorDiagnosticTimer) {
        clearTimeout(playbackErrorDiagnosticTimer);
        playbackErrorDiagnosticTimer = null;
    }
    if (state && !state.paused && reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    stateListeners.forEach(cb => cb(state));
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

function schedulePlaybackErrorDiagnostic(message: string) {
    if (playbackErrorDiagnosticTimer) {
        clearTimeout(playbackErrorDiagnosticTimer);
    }

    playbackErrorDiagnosticTimer = setTimeout(() => {
        playbackErrorDiagnosticTimer = null;

        const state = currentState;
        if (state && !state.paused) return;

        diagnosePlaybackError(message);
    }, 8000);
}

export async function sdkReconnectNow() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    deviceId = null;
    notifyState(null);
    resetReady();

    if (!sdkPlayer) {
        const loaded = await loadSdk();
        if (!loaded) throw new Error('Spotify SDK player is not loaded');
        await waitForReadyDevice();
        return;
    }

    if (await reconnectExistingPlayer()) return;

    try {
        intentionalDisconnectInFlight = true;
        sdkPlayer.disconnect();
    } catch {

    } finally {
        intentionalDisconnectInFlight = false;
    }
    sdkPlayer = null;

    const connected = await initializeSpotifyPlayer();

    if (!connected) {
        throw new Error('Spotify Web Playback SDK reconnect was rejected');
    }

    await waitForReadyDevice();
}

export async function loadSdk(): Promise<boolean> {
    installGestureActivationListeners();

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
        console.info('[spotify@built-in] Running on localhost over HTTP is allowed, but Spotify features may still require HTTPS in production.');
    }

    window.onSpotifyWebPlaybackSDKReady = () => {
        void initializeSpotifyPlayer();
    };

    try {
        await createSdkScriptPromise();
        const connected = await initializeSpotifyPlayer();
        if (!connected) return false;
        await waitForReadyDevice();
        return true;
    } catch (error) {
        spotifyConsoleError('Spotify Web Playback SDK is not ready.', error);
        return false;
    }
}

export function isSdkLoadStarted() { return sdkLoadStarted; }

export async function sdkPlay(trackId: string) {
    playbackCommandInFlight += 1;

    try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const loaded = await loadSdk();
            if (!loaded) {
                throw makeSpotifyActionError(
                    'initialize playback',
                    lastSdkSetupError ?? 'Spotify SDK player is not loaded'
                );
            }

            await waitForReadyDevice();
            const token = await getValidToken();
            const targetDeviceId = deviceId;
            const player = sdkPlayer;
            if (!token) throw makeSpotifyActionError('start playback', 'Spotify token is unavailable');
            if (!targetDeviceId || !player) throw makeSpotifyActionError('start playback', 'Spotify browser player is not ready');

            try {
                await player.activateElement();
                await playTrackOnDevice(token, targetDeviceId, trackId);

                if (!(await waitForActiveSpotifyDevice(token, targetDeviceId))) {
                    await playTrackOnDevice(token, targetDeviceId, trackId);
                }

                return;
            } catch (error) {
                if (attempt > 0) {
                    const playbackError = makeSpotifyActionError('start playback', error);
                    reportPlaybackIssue(playbackError.message);
                    throw playbackError;
                }

                await sdkReconnectNow();
            }
        }
    } finally {
        playbackCommandInFlight = Math.max(0, playbackCommandInFlight - 1);
    }
}

export async function sdkPause(options: { silentIfMissing?: boolean } = {}) {
    await putSpotifyCommand('/me/player/pause', 'Spotify pause failed', {
        ignoreMissingDevice: options.silentIfMissing,
    });
}

export async function sdkResume() {
    installGestureActivationListeners();
    await sdkPlayer?.activateElement();
    await putSpotifyCommand('/me/player/play', 'Spotify resume failed', {
        reconnectOnMissingDevice: true,
    });
}

export async function sdkSeek(ms: number) {
    await putSpotifyCommand(
        `/me/player/seek?position_ms=${Math.max(0, Math.floor(ms))}`,
        'Spotify seek failed',
        { reconnectOnMissingDevice: true }
    );
}

export async function sdkSetVolume(fraction: number) {
    if (!currentState) return;
    await sdkPlayer?.setVolume(Math.max(0, Math.min(1, fraction)));
}
export function sdkActivateElement() {
    installGestureActivationListeners();
    return sdkPlayer?.activateElement();
}

export function sdkPrimeActivation() {
    installGestureActivationListeners();
    const currentPlayer = sdkPlayer;
    if (currentPlayer) {
        return currentPlayer.activateElement();
    }

    return loadSdk().then(loaded => {
        if (!loaded) return undefined;
        return sdkPlayer?.activateElement();
    });
}

export function sdkDisconnect() {
    try {
        intentionalDisconnectInFlight = true;
        sdkPlayer?.disconnect();
    } finally {
        intentionalDisconnectInFlight = false;
    }
    sdkPlayer = null;
    deviceId = null;
    currentState = null;
    resetReady();
}
