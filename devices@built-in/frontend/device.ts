import { api, getAccount, getPluginConfig, player } from '@omniplayr/plugins';
import { devicesPluginWebSocketUrl } from './websocket';

const PLUGIN_KEY = 'devices@built-in';
const DEFAULT_HEARTBEAT_INTERVAL_SECONDS = 20;
const MIN_HEARTBEAT_INTERVAL_SECONDS = 1;
const ACCOUNT_RETRY_INTERVAL_MS = 1000;
const BROWSER_DEVICE_SESSION_STORAGE_KEY = 'devices_builtin_browser_device_id';
export const DEVICES_CHANGED_EVENT = 'devices@built-in:devices-changed';

export type DeviceStatus = 'online' | 'idle' | 'unconnectable';

interface HostDeviceInfo {
    device_identifier?: string;
    device_type?: string;
    device_ip?: string | null;
    label?: string;
}

interface DeviceEmitResponse {
    id?: number;
}

interface DeviceCommandsResponse {
    commands?: DeviceCommand[];
    device_missing?: boolean;
}

interface DeviceCommand {
    id: number;
    type: string;
    payload?: Record<string, unknown>;
}

type PlayerWithLocalOutput = typeof player & {
    selectLocalOutputDevice?: () => void;
};

class DeviceEmitWebSocketRetryDelay extends Error {
    constructor(retryInMs: number) {
        super(`Device emit websocket retry is delayed for ${retryInMs}ms`);
        this.name = 'DeviceEmitWebSocketRetryDelay';
    }
}

let deviceId: number | null = null;
let heartbeatTimer: ReturnType<typeof window.setTimeout> | null = null;
let commandTimer: ReturnType<typeof window.setTimeout> | null = null;
let commandReconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
let commandSocket: WebSocket | null = null;
let commandSocketDeviceId: number | null = null;
let commandSocketAvailable = true;
let emitSocket: WebSocket | null = null;
let emitSocketConnectPromise: Promise<WebSocket> | null = null;
let emitSocketRetryAt = 0;
let heartbeatInFlight = false;
let heartbeatEmitPending = false;
let commandPollInFlight = false;
let disconnectInFlight = false;
let deviceStarted = false;
let commandPollingAvailable = true;
let commandPollingRecoveryInFlight = false;
let deviceBackendAvailable = true;
let requestedStatus: DeviceStatus | null = null;
let lastSentStatus: DeviceStatus | null = null;
let visibilityListenerAttached = false;
let lifecycleListenersAttached = false;
let accountListenerAttached = false;
let frontendEventListenerAttached = false;
const deviceIdListeners = new Set<(id: number | null) => void>();
let remoteAudio: HTMLAudioElement | null = null;
let remotePlaybackMode: 'audio' | 'player' | null = null;

function isNotFoundError(error: unknown) {
    return error instanceof Error && /\b404\b/.test(error.message);
}

function isEmitRetryDelay(error: unknown) {
    return error instanceof DeviceEmitWebSocketRetryDelay;
}

function recoverCommandPollingDevice() {
    if (!deviceBackendAvailable || commandPollingRecoveryInFlight) return false;

    commandPollingRecoveryInFlight = true;
    if (commandTimer !== null) {
        window.clearTimeout(commandTimer);
        commandTimer = null;
    }
    setCurrentDeviceId(null);
    void emitDevice(true);
    return true;
}

function markDeviceBackendUnavailable() {
    deviceBackendAvailable = false;
    commandPollingAvailable = false;
    commandPollingRecoveryInFlight = false;
    setCurrentDeviceId(null);

    if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
    }

    if (commandTimer !== null) {
        window.clearTimeout(commandTimer);
        commandTimer = null;
    }

    closeCommandSocket();
    closeEmitSocket();
}

function setCurrentDeviceId(id: number | null) {
    if (deviceId === id) return;

    deviceId = id;
    deviceIdListeners.forEach(listener => listener(id));
    window.dispatchEvent(new CustomEvent(DEVICES_CHANGED_EVENT));
}

function notifyDevicesChanged() {
    window.dispatchEvent(new CustomEvent(DEVICES_CHANGED_EVENT));
}

function getHostProvidedDeviceInfo(): HostDeviceInfo | null {
    const host = globalThis as typeof globalThis & {
        __OMNIPLAYR_DEVICE_INFO__?: HostDeviceInfo;
    };

    return host.__OMNIPLAYR_DEVICE_INFO__ ?? null;
}

function getBrowserDeviceIdentifier() {
    try {
        let id = window.sessionStorage.getItem(BROWSER_DEVICE_SESSION_STORAGE_KEY);
        if (!id) {
            id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            window.sessionStorage.setItem(BROWSER_DEVICE_SESSION_STORAGE_KEY, id);
        }

        return `web:${id}`;
    } catch {
        const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        return `web:${id}`;
    }
}

function isPhoneBrowser() {
    const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
    if (nav.userAgentData?.mobile) return true;

    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function isDesktopApp() {
    const host = globalThis as typeof globalThis & {
        __TAURI_INTERNALS__?: unknown;
        process?: { versions?: { electron?: string } };
    };

    return Boolean(host.__TAURI_INTERNALS__ || host.process?.versions?.electron || /Electron|Tauri/i.test(navigator.userAgent));
}

function getLocalDeviceInfo() {
    const provided = getHostProvidedDeviceInfo();
    const userAgent = navigator.userAgent || 'unknown-user-agent';
    const browserType = isPhoneBrowser() ? 'phone' : 'browser';
    const deviceType = provided?.device_type ?? (isDesktopApp() ? 'desktop' : browserType);

    return {
        identifier: provided?.device_identifier || getBrowserDeviceIdentifier(),
        type: deviceType,
        ip: provided?.device_ip ?? null,
        label: provided?.label || (browserType === 'phone' ? 'OmniPlayr Mobile' : 'OmniPlayr Web'),
    };
}

function getHeartbeatIntervalSeconds() {
    const configured = getPluginConfig<number>(
        PLUGIN_KEY,
        'devices.heartbeat_interval',
        DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
    );

    const value = Number(configured);
    if (!Number.isFinite(value)) return DEFAULT_HEARTBEAT_INTERVAL_SECONDS;

    return Math.max(MIN_HEARTBEAT_INTERVAL_SECONDS, value);
}

function getCurrentStatus(): DeviceStatus {
    if (requestedStatus) return requestedStatus;
    return document.hidden ? 'idle' : 'online';
}

function scheduleHeartbeat() {
    if (!deviceStarted || !deviceBackendAvailable) return;

    if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
    }

    heartbeatTimer = window.setTimeout(() => {
        void emitDevice();
    }, getHeartbeatIntervalSeconds() * 1000);
}

function scheduleAccountRetry() {
    if (!deviceStarted || !deviceBackendAvailable) return;

    if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
    }

    heartbeatTimer = window.setTimeout(() => {
        void emitDevice(true);
    }, ACCOUNT_RETRY_INTERVAL_MS);
}

function getRemoteAudio() {
    if (!remoteAudio) {
        remoteAudio = new Audio();
        remoteAudio.preload = 'auto';
    }

    return remoteAudio;
}

function shouldControlPlayer() {
    return remotePlaybackMode === 'player' || player.hasTrack;
}

async function executeCommand(command: DeviceCommand) {
    const audio = getRemoteAudio();
    const payload = command.payload || {};

    switch (command.type) {
        case 'play': {
            const songId = typeof payload.songId === 'string' ? payload.songId : null;
            const sourceType = typeof payload.sourceType === 'string' ? payload.sourceType : null;
            const volume = typeof payload.volume === 'number' && Number.isFinite(payload.volume)
                ? Math.max(0, Math.min(1, payload.volume))
                : null;

            if (songId && sourceType) {
                try {
                    audio.pause();
                    audio.removeAttribute('src');
                    audio.load();
                    (player as PlayerWithLocalOutput).selectLocalOutputDevice?.();
                    if (volume !== null) player.setVolume(volume);
                    await player.playSong(
                        songId,
                        sourceType,
                        typeof payload.extra === 'object' && payload.extra !== null
                            ? payload.extra as Record<string, unknown>
                            : undefined,
                        false,
                        true,
                    );

                    if (typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)) {
                        const duration = player.duration;
                        if (duration > 0) {
                            player.seek(Math.max(0, payload.currentTime) / duration);
                        }
                    }

                    remotePlaybackMode = 'player';
                    break;
                } catch (error) {
                    console.warn('Failed to start remote OmniPlayr playback, falling back to stream URL', error);
                }
            }

            const streamUrl = typeof payload.streamUrl === 'string' ? payload.streamUrl : null;
            if (!streamUrl) return;

            audio.src = streamUrl;
            if (volume !== null) audio.volume = volume;

            if (typeof payload.currentTime === 'number' && Number.isFinite(payload.currentTime)) {
                audio.currentTime = Math.max(0, payload.currentTime);
            }

            await audio.play();
            remotePlaybackMode = 'audio';
            break;
        }
        case 'pause':
            if (shouldControlPlayer()) {
                if (player.isPlaying) player.togglePlay();
                remotePlaybackMode = 'player';
            } else {
                audio.pause();
            }
            break;
        case 'resume':
            if (shouldControlPlayer()) {
                if (!player.isPlaying) player.togglePlay();
                remotePlaybackMode = 'player';
            } else {
                await audio.play();
            }
            break;
        case 'seek':
            if (typeof payload.seconds === 'number' && Number.isFinite(payload.seconds)) {
                if (shouldControlPlayer()) {
                    const duration = player.duration;
                    if (duration > 0) {
                        player.seek(Math.max(0, payload.seconds) / duration);
                    }
                    remotePlaybackMode = 'player';
                } else {
                    audio.currentTime = Math.max(0, payload.seconds);
                }
            }
            break;
        case 'next':
            if (shouldControlPlayer()) {
                await player.next();
                remotePlaybackMode = 'player';
            }
            break;
        case 'prev':
            if (shouldControlPlayer()) {
                await player.prev();
                remotePlaybackMode = 'player';
            }
            break;
        case 'shuffle':
            if (shouldControlPlayer() && typeof payload.enabled === 'boolean' && player.shuffle !== payload.enabled) {
                player.toggleShuffle();
                remotePlaybackMode = 'player';
            }
            break;
        case 'repeat':
            if (shouldControlPlayer() && typeof payload.mode === 'string') {
                const desired = payload.mode === 'all' || payload.mode === 'one' ? payload.mode : 'off';
                for (let i = 0; i < 3 && player.repeat !== desired; i += 1) {
                    player.cycleRepeat();
                }
                remotePlaybackMode = 'player';
            }
            break;
        case 'volume':
            if (typeof payload.fraction === 'number' && Number.isFinite(payload.fraction)) {
                const fraction = Math.max(0, Math.min(1, payload.fraction));
                if (shouldControlPlayer()) {
                    player.setVolume(fraction);
                    remotePlaybackMode = 'player';
                } else {
                    audio.volume = fraction;
                }
            }
            break;
        case 'stop':
            if (shouldControlPlayer()) {
                if (player.isPlaying) player.togglePlay();
            } else {
                audio.pause();
                audio.removeAttribute('src');
                audio.load();
            }
            remotePlaybackMode = null;
            break;
    }
}

function scheduleCommandPoll() {
    if (
        !deviceStarted ||
        !deviceBackendAvailable ||
        deviceId === null ||
        !commandPollingAvailable ||
        commandSocketAvailable
    ) {
        return;
    }

    if (commandTimer !== null) {
        window.clearTimeout(commandTimer);
    }

    commandTimer = window.setTimeout(() => {
        void pollCommands();
    }, 1000);
}

function closeEmitSocket() {
    const socket = emitSocket;
    emitSocket = null;
    emitSocketConnectPromise = null;

    if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
    }
}

function connectEmitSocket() {
    const retryInMs = emitSocketRetryAt - Date.now();
    if (retryInMs > 0) {
        return Promise.reject(new DeviceEmitWebSocketRetryDelay(retryInMs));
    }

    if (emitSocket?.readyState === WebSocket.OPEN) {
        return Promise.resolve(emitSocket);
    }

    if (emitSocketConnectPromise) {
        return emitSocketConnectPromise;
    }

    if (!getAccount()) {
        return Promise.reject(new Error('No account selected'));
    }

    closeEmitSocket();

    emitSocketConnectPromise = new Promise((resolve, reject) => {
        const socket = new WebSocket(devicesPluginWebSocketUrl('/plugin/devices/emit/ws'));
        emitSocket = socket;
        let settled = false;
        let timedOut = false;

        const settleReject = (error: Error) => {
            if (settled) return;

            settled = true;
            emitSocketConnectPromise = null;
            if (emitSocket === socket) emitSocket = null;
            reject(error);
        };
        const settleResolve = () => {
            if (settled) return false;

            settled = true;
            cleanup();
            emitSocketConnectPromise = null;
            resolve(socket);
            return true;
        };
        const timeout = window.setTimeout(() => {
            timedOut = true;
            settleReject(new Error('Timed out connecting to device emit websocket'));
        }, 8000);

        const cleanup = () => {
            window.clearTimeout(timeout);
            socket.removeEventListener('open', handleOpen);
            socket.removeEventListener('error', handleError);
            socket.removeEventListener('close', handleClose);
        };
        const handleOpen = () => {
            if (timedOut) {
                cleanup();
                socket.close();
                return;
            }

            settleResolve();
        };
        const handleError = () => {
            cleanup();
            settleReject(new Error('Device emit websocket failed'));
        };
        const handleClose = (event: CloseEvent) => {
            cleanup();
            settleReject(new Error(`Device emit websocket closed before opening (${event.code || 'no code'}${event.reason ? `: ${event.reason}` : ''})`));
        };

        socket.addEventListener('open', handleOpen);
        socket.addEventListener('error', handleError);
        socket.addEventListener('close', handleClose);
    });

    return emitSocketConnectPromise;
}

async function sendDeviceEmitOverSocket(payload: Record<string, unknown>) {
    const socket = await connectEmitSocket();

    return await new Promise<DeviceEmitResponse>((resolve, reject) => {
        const timer = window.setTimeout(() => {
            cleanup();
            reject(new Error('Timed out waiting for device emit websocket response'));
        }, 8000);

        const cleanup = () => {
            window.clearTimeout(timer);
            socket.removeEventListener('message', handleMessage);
            socket.removeEventListener('error', handleError);
            socket.removeEventListener('close', handleClose);
        };
        const handleMessage = (event: MessageEvent) => {
            cleanup();
            try {
                resolve(JSON.parse(event.data) as DeviceEmitResponse);
            } catch (error) {
                reject(error);
            }
        };
        const handleError = () => {
            cleanup();
            reject(new Error('Device emit websocket failed'));
        };
        const handleClose = () => {
            cleanup();
            reject(new Error('Device emit websocket closed'));
        };

        socket.addEventListener('message', handleMessage);
        socket.addEventListener('error', handleError);
        socket.addEventListener('close', handleClose);
        socket.send(JSON.stringify(payload));
    });
}

function closeCommandSocket() {
    if (commandReconnectTimer !== null) {
        window.clearTimeout(commandReconnectTimer);
        commandReconnectTimer = null;
    }

    const socket = commandSocket;
    commandSocket = null;
    commandSocketDeviceId = null;

    if (socket && socket.readyState !== WebSocket.CLOSED) {
        socket.close();
    }
}

function scheduleCommandSocketReconnect() {
    if (
        !deviceStarted ||
        !deviceBackendAvailable ||
        deviceId === null ||
        !commandSocketAvailable ||
        commandReconnectTimer !== null
    ) {
        return;
    }

    commandReconnectTimer = window.setTimeout(() => {
        commandReconnectTimer = null;
        connectCommandSocket();
    }, 2000);
}

function handleCommandResponse(response: DeviceCommandsResponse) {
    if (response.device_missing) {
        if (recoverCommandPollingDevice()) {
            console.debug('Remote device command queue disappeared; refreshing this device registration.');
        }
        return;
    }

    for (const command of response.commands || []) {
        void executeCommand(command).catch(error => {
            console.error('Failed to execute remote device command', error);
        });
    }
}

function connectCommandSocket() {
    if (!deviceStarted || !deviceBackendAvailable || deviceId === null || !commandSocketAvailable) return;
    if (
        commandSocket &&
        commandSocketDeviceId === deviceId &&
        (commandSocket.readyState === WebSocket.OPEN || commandSocket.readyState === WebSocket.CONNECTING)
    ) {
        return;
    }

    closeCommandSocket();

    const nextDeviceId = deviceId;
    const socket = new WebSocket(devicesPluginWebSocketUrl(`/plugin/device/${nextDeviceId}/commands/ws`));
    commandSocket = socket;
    commandSocketDeviceId = nextDeviceId;

    socket.addEventListener('message', event => {
        try {
            handleCommandResponse(JSON.parse(event.data) as DeviceCommandsResponse);
        } catch (error) {
            console.error('Failed to process remote device command message', error);
        }
    });

    socket.addEventListener('close', () => {
        if (commandSocket === socket) {
            commandSocket = null;
            commandSocketDeviceId = null;
        }

        scheduleCommandSocketReconnect();
    });

    socket.addEventListener('error', () => {
        commandSocketAvailable = false;
        closeCommandSocket();
        scheduleCommandPoll();
    });
}

async function pollCommands() {
    if (!deviceStarted || !deviceBackendAvailable || deviceId === null || commandPollInFlight || !commandPollingAvailable) return;

    commandPollInFlight = true;

    try {
        const response = await api(`/plugin/device/${deviceId}/commands`) as DeviceCommandsResponse;

        handleCommandResponse(response);
    } catch (error) {
        if (isNotFoundError(error)) {
            if (recoverCommandPollingDevice()) {
                console.debug('Remote device command queue disappeared; refreshing this device registration.');
                return;
            }

            console.debug('Remote device command queue is still unavailable while registration is refreshing.');
            return;
        }

        console.error('Failed to poll remote device commands', error);
    } finally {
        commandPollInFlight = false;
        scheduleCommandPoll();
    }
}

function isTransferTarget(data: unknown) {
    if (!data || typeof data !== 'object' || deviceId === null) return false;

    const eventData = data as {
        target_device?: {
            device_identifier?: unknown;
        };
    };
    const targetIdentifier = eventData.target_device?.device_identifier;

    return targetIdentifier === `remote:${deviceId}`;
}

function attachFrontendEventListener() {
    if (frontendEventListenerAttached) return;

    frontendEventListenerAttached = true;
    window.addEventListener('omniplayr:frontend-event', event => {
        const customEvent = event as CustomEvent<{ event?: string; data?: unknown }>;
        if (customEvent.detail?.event !== 'player.device_transfer') return;
        if (!isTransferTarget(customEvent.detail.data)) return;

        if (!commandSocketAvailable) {
            void pollCommands();
        }
    });
}

async function emitDevice(force = false) {
    if (!deviceStarted || !deviceBackendAvailable || disconnectInFlight) return;
    if (heartbeatInFlight) {
        heartbeatEmitPending ||= force;
        return;
    }
    if (!getAccount()) {
        scheduleAccountRetry();
        return;
    }

    heartbeatInFlight = true;

    try {
        const payload = {
            id: deviceId,
            ...getLocalDeviceInfo(),
            status: getCurrentStatus(),
        };
        let response: DeviceEmitResponse;

        try {
            response = await sendDeviceEmitOverSocket(payload);
        } catch (error) {
            closeEmitSocket();
            if (!isEmitRetryDelay(error)) {
                emitSocketRetryAt = Date.now() + 5000;
                console.warn('Device emit websocket unavailable; falling back to REST heartbeat.', error);
            }
            response = await api(
                '/plugin/devices/emit',
                payload,
                undefined,
                true,
                false,
                'POST',
            ) as DeviceEmitResponse;
        }

        if (typeof response?.id === 'number') {
            commandPollingAvailable = true;
            commandPollingRecoveryInFlight = false;
            const previousDeviceId = deviceId;
            setCurrentDeviceId(response.id);
            if (previousDeviceId === response.id) {
                notifyDevicesChanged();
            }
            connectCommandSocket();
        }

        const currentStatus = getCurrentStatus();
        if (lastSentStatus !== currentStatus) {
            notifyDevicesChanged();
        }
        lastSentStatus = currentStatus;
    } catch (error) {
        lastSentStatus = 'unconnectable';
        commandPollingRecoveryInFlight = false;
        if (isNotFoundError(error)) {
            markDeviceBackendUnavailable();
            console.debug('Devices backend routes are unavailable; disabling account device heartbeat for this session.');
            return;
        }
        console.error('Failed to emit device heartbeat', error);
    } finally {
        heartbeatInFlight = false;
        if (heartbeatEmitPending) {
            heartbeatEmitPending = false;
            void emitDevice(true);
        } else {
            scheduleHeartbeat();
        }
    }
}

function stopHeartbeat() {
    deviceStarted = false;

    if (heartbeatTimer !== null) {
        window.clearTimeout(heartbeatTimer);
        heartbeatTimer = null;
    }

    if (commandTimer !== null) {
        window.clearTimeout(commandTimer);
        commandTimer = null;
    }

    closeCommandSocket();
    closeEmitSocket();
}

async function disconnectDevice() {
    if (!deviceBackendAvailable || disconnectInFlight) return;

    const id = deviceId;
    if (id === null) {
        stopHeartbeat();
        return;
    }

    disconnectInFlight = true;
    stopHeartbeat();

    try {
        await api(
            '/plugin/devices/disconnect',
            {
                id,
                ...getLocalDeviceInfo(),
            },
            undefined,
            false,
            false,
            'POST',
        );
    } catch (error) {
        console.error('Failed to disconnect device', error);
    } finally {
        setCurrentDeviceId(null);
        lastSentStatus = null;
        notifyDevicesChanged();
        disconnectInFlight = false;

        if (deviceStarted) {
            void emitDevice();
        }
    }
}

function attachVisibilityListener() {
    if (visibilityListenerAttached) return;

    visibilityListenerAttached = true;
    document.addEventListener('visibilitychange', () => {
        if (requestedStatus) return;
        void emitDevice();
    });
}

function attachLifecycleListeners() {
    if (lifecycleListenersAttached) return;

    lifecycleListenersAttached = true;
    window.addEventListener('pagehide', () => {
        void disconnectDevice();
    });
    window.addEventListener('beforeunload', () => {
        void disconnectDevice();
    });
    window.addEventListener('pageshow', () => {
        if (!deviceStarted) {
            initDevice(requestedStatus ?? undefined);
        }
    });
}

function attachAccountListener() {
    if (accountListenerAttached) return;

    accountListenerAttached = true;
    const refreshDevice = () => {
        void emitDevice(true);
    };

    window.addEventListener('account-switched', () => {
        closeEmitSocket();
        emitSocketRetryAt = 0;
        refreshDevice();
    });
    window.addEventListener('storage', () => {
        closeCommandSocket();
        closeEmitSocket();
        emitSocketRetryAt = 0;
        commandSocketAvailable = true;
        refreshDevice();
    });
}

export function setDeviceStatus(status: DeviceStatus) {
    requestedStatus = status;
    void emitDevice();
}

export function clearDeviceStatus() {
    requestedStatus = null;
    void emitDevice();
}

export function getLastSentDeviceStatus() {
    return lastSentStatus;
}

export function getCurrentDeviceId() {
    return deviceId;
}

export function getCurrentDeviceInfo() {
    if (deviceId === null) return null;

    return {
        id: deviceId,
        ...getLocalDeviceInfo(),
        status: lastSentStatus ?? getCurrentStatus(),
    };
}

export function ensureDeviceRegistered() {
    return emitDevice(true);
}

export function subscribeCurrentDeviceId(listener: (id: number | null) => void) {
    deviceIdListeners.add(listener);
    return () => {
        deviceIdListeners.delete(listener);
    };
}

export function initDevice(status?: DeviceStatus) {
    deviceStarted = true;
    requestedStatus = status ?? requestedStatus;
    attachVisibilityListener();
    attachLifecycleListeners();
    attachAccountListener();
    attachFrontendEventListener();
    void emitDevice();
}
