import {
    api,
    player,
    type AudioOutputDevice,
    type AudioOutputPlaybackRequest,
    type AudioOutputPlugin,
    type AudioOutputPluginCallbacks,
} from '@omniplayr/plugins';

export const REMOTE_OUTPUT_PLUGIN_ID = 'devices@built-in:remote';

interface RemoteDevice {
    id?: number | string | null;
    type: string;
    label?: string | null;
    status?: string | null;
}

let remoteDevices: AudioOutputDevice[] = [];
let activeDeviceId: number | null = null;
let activeCallbacks: AudioOutputPluginCallbacks | null = null;
let commandsAvailable = true;

function isNotFoundError(error: unknown) {
    return error instanceof Error && /\b404\b/.test(error.message);
}

function markCommandsUnavailable() {
    commandsAvailable = false;
}

function numericDeviceId(device: AudioOutputDevice) {
    const match = device.device_identifier.match(/^remote:(\d+)$/);
    return match ? Number(match[1]) : null;
}

async function sendRemoteCommand(deviceId: number, type: string, payload: Record<string, unknown> = {}) {
    if (!commandsAvailable) {
        throw new Error('Remote device commands are unavailable on this backend.');
    }

    try {
        await api(
            `/plugin/device/${deviceId}/command`,
            { type, payload },
            undefined,
            true,
            false,
            'POST',
        );
    } catch (error) {
        if (isNotFoundError(error)) {
            markCommandsUnavailable();
        }

        throw error;
    }
}

function sendRemoteCommandQuietly(deviceId: number, type: string, payload: Record<string, unknown> = {}) {
    void sendRemoteCommand(deviceId, type, payload).catch(error => {
        activeCallbacks?.onError(error);
    });
}

export function remoteOutputDeviceForDevice(device: RemoteDevice): AudioOutputDevice | null {
    if (typeof device.id !== 'number' || device.status === 'unconnectable') return null;

    return {
        device_identifier: `remote:${device.id}`,
        device_type: device.type,
        label: device.label || undefined,
    };
}

export function updateRemoteOutputDevices(devices: RemoteDevice[], currentDeviceId: number | null) {
    remoteDevices = devices
        .filter(device => typeof device.id === 'number' && device.id !== currentDeviceId && device.status !== 'unconnectable')
        .map(device => remoteOutputDeviceForDevice(device))
        .filter((device): device is AudioOutputDevice => device !== null);
}

const remoteOutputPlugin: AudioOutputPlugin = {
    listDevices() {
        return remoteDevices;
    },

    async play(request: AudioOutputPlaybackRequest, callbacks: AudioOutputPluginCallbacks) {
        const deviceId = numericDeviceId(request.device);
        if (deviceId === null) throw new Error('Invalid remote device');

        activeDeviceId = deviceId;
        activeCallbacks = callbacks;

        await sendRemoteCommand(deviceId, 'play', {
            songId: request.songId,
            sourceType: request.sourceType,
            extra: request.extra,
            streamUrl: request.streamUrl,
            contentType: request.contentType,
            metadata: request.metadata,
            currentTime: player.currentTime || 0,
            volume: player.volumeFraction,
        });

        callbacks.onReady();
        callbacks.onStateChange();
    },

    pause() {
        if (activeDeviceId !== null) sendRemoteCommandQuietly(activeDeviceId, 'pause');
    },

    resume() {
        if (activeDeviceId !== null) sendRemoteCommandQuietly(activeDeviceId, 'resume');
    },

    seek(seconds: number) {
        if (activeDeviceId !== null) sendRemoteCommandQuietly(activeDeviceId, 'seek', { seconds });
    },

    setVolume(fraction: number) {
        if (activeDeviceId !== null) {
            sendRemoteCommandQuietly(activeDeviceId, 'volume', {
                fraction: Math.max(0, Math.min(1, fraction)),
            });
        }
    },

    stop() {
        if (activeDeviceId !== null) sendRemoteCommandQuietly(activeDeviceId, 'stop');
        activeDeviceId = null;
        activeCallbacks = null;
    },
};

export function initRemoteOutput() {
    player.registerOutputPlugin(REMOTE_OUTPUT_PLUGIN_ID, remoteOutputPlugin);
}
