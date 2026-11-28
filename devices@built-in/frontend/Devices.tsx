import { useEffect, useState } from "react";
import './styles/Devices.css';
import { api, getAccount, getPluginConfig, player, type AudioOutputDevice } from "@omniplayr/plugins";
import { Airplay, Bluetooth, Car, Cast, Globe, LoaderCircle, Monitor, Radio, Smartphone, Speaker, Tablet, TvMinimal, Watch, Wifi } from "lucide-react";
import translations from "./translations";
import { DEVICES_CHANGED_EVENT, ensureDeviceRegistered, getCurrentDeviceId, getCurrentDeviceInfo, subscribeCurrentDeviceId } from './device';
import { GOOGLE_CAST_OUTPUT_PLUGIN_ID, OUTPUT_DEVICES_CHANGED_EVENT, selectGoogleCastOutput } from './castOutput';
import { REMOTE_OUTPUT_PLUGIN_ID, remoteOutputDeviceForDevice, updateRemoteOutputDevices } from './remoteOutput';
import { devicesPluginWebSocketUrl } from './websocket';

const PLUGIN_KEY = 'devices@built-in';
const DEFAULT_REFRESH_INTERVAL_SECONDS = 5;
const MIN_REFRESH_INTERVAL_SECONDS = 1;
const DEVICES_REQUEST_CACHE_MS = 2000;
let devicesRequest: Promise<Device[]> | null = null;
let devicesRequestStartedAt = 0;
let cachedDevices: Device[] | null = null;

interface Device {
    id?: number | string | null;
    identifier: string;
    type: string;
    protocol?: string | null;
    ip?: string | null;
    port?: number | null;
    label?: string | null;
    manufacturer?: string | null;
    model?: string | null;
    status?: string | null;
    local?: boolean;
    discovered?: boolean;
    outputPluginId?: string;
    outputDevice?: AudioOutputDevice;
    selected?: boolean;
    playing?: boolean;
}

interface CastDeviceType {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
}

interface DevicesListMessage {
    type?: string;
    devices?: Device[];
}

interface SyncedPlaybackInfo {
    deviceLabel?: string | null;
}

type PlayerWithSyncedPlaybackInfo = typeof player & {
    syncedPlaybackInfo?: SyncedPlaybackInfo | null;
};

function getSyncedPlaybackInfo() {
    return (player as PlayerWithSyncedPlaybackInfo).syncedPlaybackInfo ?? null;
}

async function getDevices(force = false): Promise<Device[]> {
    const now = Date.now();
    if (!force && devicesRequest && now - devicesRequestStartedAt < DEVICES_REQUEST_CACHE_MS) {
        return devicesRequest;
    }
    if (!force && cachedDevices && now - devicesRequestStartedAt < DEVICES_REQUEST_CACHE_MS) {
        return cachedDevices;
    }

    devicesRequestStartedAt = now;
    devicesRequest = (async () => {
    try {
        const { devices } = await api('/plugin/devices/list') as {
            devices: Device[];
        };

        cachedDevices = devices;
        return devices;
    } catch (error) {
        if (error instanceof Error && /\b404\b/.test(error.message)) {
            cachedDevices = [];
            return [];
        }

        throw error;
    } finally {
        devicesRequest = null;
    }
    })();

    return devicesRequest;
}

function outputDeviceKey(pluginId: string, device: AudioOutputDevice) {
    return `${pluginId}:${device.device_type}:${device.device_identifier}`;
}

function isCastOutputDevice(pluginId: string, device: AudioOutputDevice) {
    if (pluginId === REMOTE_OUTPUT_PLUGIN_ID) return false;
    if (pluginId === PLUGIN_KEY) return true;

    const value = `${pluginId} ${device.device_type} ${device.device_identifier}`.toLowerCase();
    return (
        value.includes('cast') ||
        value.includes('airplay') ||
        value.includes('dlna') ||
        value.includes('upnp') ||
        value.includes('sonos') ||
        value.includes('fire-tv') ||
        value.includes('firetv')
    );
}

function getOutputDevices(): Device[] {
    const selectedOutputDevice = player.selectedOutputDevice;

    return player.getOutputDevices()
        .filter(({ pluginId, device }) => isCastOutputDevice(pluginId, device))
        .map(({ pluginId, device }) => ({
            id: `output:${outputDeviceKey(pluginId, device)}`,
            identifier: device.device_identifier,
            type: device.device_type,
            ip: device.device_ip ?? null,
            label: device.label ?? null,
            status: 'online',
            local: true,
            outputPluginId: pluginId,
            outputDevice: device,
            selected:
                selectedOutputDevice?.pluginId === pluginId &&
                selectedOutputDevice.device.device_identifier === device.device_identifier &&
                selectedOutputDevice.device.device_type === device.device_type,
        }));
}

function isSelectedOutputDevice(pluginId: string, device: AudioOutputDevice) {
    const selectedOutputDevice = player.selectedOutputDevice;

    return (
        selectedOutputDevice?.pluginId === pluginId &&
        selectedOutputDevice.device.device_identifier === device.device_identifier &&
        selectedOutputDevice.device.device_type === device.device_type
    );
}

function getLocalOutputDevice() {
    return player.getOutputDevices()
        .find(({ pluginId, device }) => (
            pluginId !== REMOTE_OUTPUT_PLUGIN_ID &&
            !isCastOutputDevice(pluginId, device)
        )) ?? null;
}

function normalizedDeviceIdentity(device: Device) {
    return [
        device.type || 'device',
        device.identifier || '',
        device.ip || '',
        device.label || '',
        device.manufacturer || '',
        device.model || '',
        device.protocol || '',
    ].join('|').toLowerCase();
}

function devicePreference(device: Device, currentDeviceId: number | null) {
    const current = device.id === currentDeviceId ? 1_000_000 : 0;
    const online = device.status === 'online' ? 10_000 : device.status === 'idle' ? 1_000 : 0;
    const numericId = typeof device.id === 'number' ? device.id : 0;

    return current + online + numericId;
}

function dedupeDevices(devices: Device[], currentDeviceId: number | null) {
    const byIdentity = new Map<string, Device>();

    for (const device of devices) {
        const key = normalizedDeviceIdentity(device);
        const existing = byIdentity.get(key);
        if (!existing || devicePreference(device, currentDeviceId) > devicePreference(existing, currentDeviceId)) {
            byIdentity.set(key, device);
        }
    }

    return Array.from(byIdentity.values());
}

function getVisibleDevicesFromRemote(remoteDeviceList: Device[], currentDeviceId: number | null): Device[] {
    const currentDeviceInfo = getCurrentDeviceInfo();
    const remoteDevicesWithCurrent = currentDeviceInfo && !remoteDeviceList.some(device => device.id === currentDeviceInfo.id)
        ? [currentDeviceInfo, ...remoteDeviceList]
        : remoteDeviceList;
    const remoteDevices = dedupeDevices(remoteDevicesWithCurrent, currentDeviceId);

    updateRemoteOutputDevices(remoteDevices, currentDeviceId);

    const localOutputDevice = getLocalOutputDevice();
    const accountDevices = remoteDevices.map(device => {
        if (device.id === currentDeviceId && localOutputDevice) {
            return {
                ...device,
                outputPluginId: localOutputDevice.pluginId,
                outputDevice: localOutputDevice.device,
                selected: isSelectedOutputDevice(localOutputDevice.pluginId, localOutputDevice.device),
            };
        }

        const outputDevice = remoteOutputDeviceForDevice(device);

        return outputDevice ? {
            ...device,
            outputPluginId: REMOTE_OUTPUT_PLUGIN_ID,
            outputDevice,
            selected: isSelectedOutputDevice(REMOTE_OUTPUT_PLUGIN_ID, outputDevice),
        } : device;
    });

    return [
        ...accountDevices,
        ...getOutputDevices(),
    ];
}

async function getVisibleDevices(currentDeviceId: number | null, force = false): Promise<Device[]> {
    if (currentDeviceId === null) {
        await ensureDeviceRegistered();
        currentDeviceId = getCurrentDeviceId();
    }

    return getVisibleDevicesFromRemote(await getDevices(force), currentDeviceId);
}

function devicesWebSocketUrl() {
    return devicesPluginWebSocketUrl('/plugin/devices/list/ws');
}
function getRefreshIntervalSeconds() {
    const configured = getPluginConfig<number>(
        PLUGIN_KEY,
        'devices.refresh_interval',
        DEFAULT_REFRESH_INTERVAL_SECONDS,
    );

    const value = Number(configured);
    if (!Number.isFinite(value)) return DEFAULT_REFRESH_INTERVAL_SECONDS;

    return Math.max(MIN_REFRESH_INTERVAL_SECONDS, value);
}

function DeviceIcon({ type }: { type: string }) {
    const className = `device-icon device-icon-${type}`;
    switch (type) {
        case 'browser':
            return <Globe className={className} />;
        case 'phone':
            return <Smartphone className={className} />;
        case 'desktop':
            return <Monitor className={className} />
        case 'tablet':
            return <Tablet className={className} />
        case 'tv':
            return <TvMinimal className={className} />
        case 'speaker':
            return <Speaker className={className} />
        case 'car':
            return <Car className={className} />
        case 'watch':
            return <Watch className={className} />
        case 'bluetooth':
            return <Bluetooth className={className} />
        default:
            return <Monitor className={className} />
    }
}

type Translate = (key: string, values?: Record<string, unknown>) => string;

function getDeviceName(identifier: string, t: Translate) {
    const value = identifier.trim();

    if (!value) return t('devices.unknown');

    const isUserAgent =
        value.includes('Mozilla/') ||
        value.includes('AppleWebKit/') ||
        value.includes('Chrome/') ||
        value.includes('Firefox/') ||
        value.includes('Safari/');

    if (!isUserAgent) {
        return value
            .replace(/[-_]+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\b\w/g, character => character.toUpperCase());
    }

    let browser = t('devices.browser');
    const desktop = t('devices.desktop');
    let device = desktop;
    let operatingSystem = '';

    if (/Edg\//i.test(value)) {
        browser = 'Microsoft Edge';
    } else if (/OPR\//i.test(value)) {
        browser = 'Opera';
    } else if (/Firefox\//i.test(value)) {
        browser = 'Firefox';
    } else if (/CriOS\//i.test(value)) {
        browser = 'Chrome';
    } else if (/Chrome\//i.test(value)) {
        browser = 'Chrome';
    } else if (/Safari\//i.test(value)) {
        browser = 'Safari';
    }

    if (/iPhone/i.test(value)) {
        device = 'iPhone';
        operatingSystem = 'iOS';
    } else if (/iPad/i.test(value)) {
        device = 'iPad';
        operatingSystem = 'iPadOS';
    } else if (/Android/i.test(value)) {
        const model = value.match(/Android[^;]*;\s*([^;)]+?)(?:\s+Build\/[^;)]+)?[;)]/i)?.[1];

        device = model?.trim() || t('devices.android');
        operatingSystem = 'Android';
    } else if (/Windows NT/i.test(value)) {
        operatingSystem = 'Windows';
    } else if (/Macintosh|Mac OS X/i.test(value)) {
        operatingSystem = 'macOS';
    } else if (/CrOS/i.test(value)) {
        operatingSystem = 'ChromeOS';
    } else if (/Linux/i.test(value)) {
        operatingSystem = 'Linux';
    }

    if (device !== desktop) {
        return t('devices.browser_on_device', { browser, device });
    }

    if (operatingSystem) {
        return t('devices.browser_on_os', { browser, operatingSystem });
    }

    return browser;
}

function getCastDeviceType(device: Device, t: Translate): CastDeviceType | null {
    const value = [
        device.type,
        device.protocol,
        device.identifier,
        device.manufacturer,
        device.model,
    ].filter(Boolean).join(' ').toLowerCase();

    if (
        value.includes('google-cast') ||
        value.startsWith('gcast') ||
        value.includes('chromecast') ||
        value.includes('googlecast')
    ) {
        return {
            label: t('devices.cast.google'),
            icon: Cast,
        };
    }

    if (value.includes('airplay') || value.includes('raop')) {
        return {
            label: t('devices.cast.airplay'),
            icon: Airplay,
        };
    }

    if (
        value.includes('firetv') ||
        value.includes('fire-tv') ||
        value.includes('amazon-fire') ||
        value.includes('amazonfire')
    ) {
        return {
            label: t('devices.cast.fire_tv'),
            icon: TvMinimal,
        };
    }

    if (value.includes('dial')) {
        return {
            label: t('devices.cast.dial'),
            icon: TvMinimal,
        };
    }

    if (value.includes('sonos')) {
        return {
            label: t('devices.cast.sonos'),
            icon: Radio,
        };
    }

    if (value.includes('dlna') || value.includes('upnp')) {
        return {
            label: t('devices.cast.dlna'),
            icon: Wifi,
        };
    }

    return null;
}

function getCurrentDeviceLabel(type: string, t: Translate) {
    switch (type) {
        case 'phone':
            return t('devices.current.phone');
        case 'tablet':
            return t('devices.current.tablet');
        case 'desktop':
        case 'browser':
            return t('devices.current.computer');
        default:
            return t('devices.current.device');
    }
}

function DeviceItem({
    device,
    current = false,
    onSelect,
}: {
    device: Device;
    current?: boolean;
    onSelect?: (device: Device) => void;
}) {
    const { t } = translations.useTranslation();
    const castDeviceType = getCastDeviceType(device, t);
    const CastDeviceIcon = castDeviceType?.icon;
    const selectable = Boolean(onSelect);

    const statusLabel =
        device.playing
            ? t('devices.status.playing')
            : device.status === 'online'
            ? t('devices.status.online')
            : device.status === 'idle'
                ? t('devices.status.idle')
                : device.status === 'unconnectable'
                    ? t('devices.status.unconnectable')
                    : null;
    const currentDeviceLabel = current ? getCurrentDeviceLabel(device.type, t) : null;
    const visibleStatusLabel = statusLabel ?? (current ? t('devices.status.online') : null);

    return (
        <div
            className={`device${current ? ' device-current-device' : ''}${device.selected ? ' device-selected' : ''}${device.playing ? ' device-playing' : ''}${selectable ? ' device-selectable' : ''}`}
            onClick={selectable ? () => onSelect?.(device) : undefined}
            onKeyDown={selectable ? event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onSelect?.(device);
            } : undefined}
            role={selectable ? 'button' : undefined}
            tabIndex={selectable ? 0 : undefined}
        >
            <DeviceIcon type={device.type} />
            <div className='device-info'>
                <span className="device-label">{device.label || getDeviceName(device.identifier, t)}</span>
                {castDeviceType && CastDeviceIcon ? (
                    <span className="device-type">
                        <CastDeviceIcon className="device-type-icon" />
                        {castDeviceType.label}
                    </span>
                ) : visibleStatusLabel || currentDeviceLabel ? (
                    <span className={`device-status device-status-${device.status}`}>
                        {visibleStatusLabel}
                        {currentDeviceLabel && (
                            <>
                                <span className='device-current-separator'> &bull; </span>
                                <span className='device-current-text'>{currentDeviceLabel}</span>
                            </>
                        )}
                    </span>
                ) : null}
            </div>
        </div>
    )
}

function Devices() {
    const { t } = translations.useTranslation();
    const [ devices, setDevices ] = useState<Device[]>([]);
    const [ devicesLoading, setDevicesLoading ] = useState(true);
    const [ currentDeviceId, setCurrentDeviceId ] = useState(getCurrentDeviceId);
    const [ castPickerLoading, setCastPickerLoading ] = useState(false);
    const [ syncedPlaybackInfo, setSyncedPlaybackInfo ] = useState(getSyncedPlaybackInfo);
    useEffect(() => subscribeCurrentDeviceId(setCurrentDeviceId), []);
    useEffect(() => player.subscribe(() => setSyncedPlaybackInfo(getSyncedPlaybackInfo())), []);

    useEffect(() => {
        let disposed = false;
        let requestId = 0;
        let refreshTimer: ReturnType<typeof window.setTimeout> | null = null;
        let socketReconnectTimer: ReturnType<typeof window.setTimeout> | null = null;
        let socket: WebSocket | null = null;
        let socketAvailable = true;
        let socketOpen = false;
        let latestRemoteDevices: Device[] | null = null;

        const refreshDevices = async (showLoading: boolean, force = false) => {
            const currentRequestId = ++requestId;

            if (showLoading) {
                setDevicesLoading(true);
            }

            try {
                const nextDevices = await getVisibleDevices(currentDeviceId, force);

                if (!disposed && currentRequestId === requestId) {
                    setDevices(nextDevices);
                }
            } catch (error) {
                console.error('Failed to load devices', error);
            } finally {
                if (!disposed && currentRequestId === requestId) {
                    setDevicesLoading(false);
                }
            }
        };

        const applyRemoteDevices = async (remoteDevices: Device[]) => {
            const currentRequestId = ++requestId;
            latestRemoteDevices = remoteDevices;

            if (currentDeviceId === null) {
                await ensureDeviceRegistered();
            }

            if (!disposed && currentRequestId === requestId) {
                setDevices(getVisibleDevicesFromRemote(remoteDevices, getCurrentDeviceId()));
                setDevicesLoading(false);
            }
        };

        const scheduleRefresh = () => {
            if (disposed || socketAvailable) return;

            refreshTimer = window.setTimeout(() => {
                void refreshDevices(false).finally(scheduleRefresh);
            }, getRefreshIntervalSeconds() * 1000);
        };
        const scheduleSocketReconnect = () => {
            if (disposed || socketReconnectTimer !== null) return;

            socketReconnectTimer = window.setTimeout(() => {
                socketReconnectTimer = null;
                socketAvailable = true;
                connectSocket();
            }, 5000);
        };
        const refreshOutputDevices = () => {
            if (latestRemoteDevices) {
                setDevices(getVisibleDevicesFromRemote(latestRemoteDevices, getCurrentDeviceId()));
                return;
            }

            void refreshDevices(false, true);
        };
        const refreshKnownDevices = () => {
            if (!socketOpen) {
                void refreshDevices(false, true);
            }
        };
        const closeSocket = () => {
            if (socketReconnectTimer !== null) {
                window.clearTimeout(socketReconnectTimer);
                socketReconnectTimer = null;
            }

            const currentSocket = socket;
            socket = null;
            socketOpen = false;

            if (currentSocket && currentSocket.readyState !== WebSocket.CLOSED) {
                currentSocket.close();
            }
        };
        const connectSocket = () => {
            if (disposed || !socketAvailable) {
                scheduleRefresh();
                return;
            }

            if (!getAccount()) {
                setDevices(getVisibleDevicesFromRemote([], getCurrentDeviceId()));
                setDevicesLoading(false);
                return;
            }

            closeSocket();

            const nextSocket = new WebSocket(devicesWebSocketUrl());
            socket = nextSocket;

            nextSocket.addEventListener('open', () => {
                if (socket === nextSocket) {
                    socketOpen = true;
                    socketAvailable = true;
                }
            });

            nextSocket.addEventListener('message', event => {
                try {
                    const message = JSON.parse(event.data) as DevicesListMessage;
                    if (Array.isArray(message.devices)) {
                        void applyRemoteDevices(message.devices);
                    }
                } catch (error) {
                    console.error('Failed to process devices websocket message', error);
                }
            });

            nextSocket.addEventListener('close', () => {
                if (socket === nextSocket) {
                    socket = null;
                    socketOpen = false;
                }

                if (!disposed && socketAvailable) {
                    socketReconnectTimer = window.setTimeout(connectSocket, 2000);
                }
            });

            nextSocket.addEventListener('error', () => {
                socketAvailable = false;
                closeSocket();
                void refreshDevices(true, true).finally(scheduleRefresh);
                scheduleSocketReconnect();
            });
        };
        const reconnectSocket = () => {
            socketAvailable = true;
            connectSocket();
        };

        connectSocket();
        window.addEventListener(OUTPUT_DEVICES_CHANGED_EVENT, refreshOutputDevices);
        window.addEventListener(DEVICES_CHANGED_EVENT, refreshKnownDevices);
        window.addEventListener('account-switched', reconnectSocket);

        return () => {
            disposed = true;
            requestId++;
            closeSocket();
            window.removeEventListener(OUTPUT_DEVICES_CHANGED_EVENT, refreshOutputDevices);
            window.removeEventListener(DEVICES_CHANGED_EVENT, refreshKnownDevices);
            window.removeEventListener('account-switched', reconnectSocket);

            if (refreshTimer !== null) {
                window.clearTimeout(refreshTimer);
            }
        };
    }, [currentDeviceId]);

    const playbackDeviceLabel = syncedPlaybackInfo?.deviceLabel ?? null;
    const markPlaybackDevice = (device: Device): Device => {
        const label = device.label || getDeviceName(device.identifier, t);
        const labelMatches = syncedPlaybackInfo && playbackDeviceLabel
            ? label === playbackDeviceLabel
            : false;
        return {
            ...device,
            playing: labelMatches || (!syncedPlaybackInfo && player.hasTrack && device.selected === true),
        };
    };
    const visibleDevices = devices.map(markPlaybackDevice).map(device => ({
        ...device,
        selected: syncedPlaybackInfo || !player.hasTrack ? false : device.selected,
    }));
    const currentDevice = visibleDevices.find(device => device.id === currentDeviceId) ?? null;
    const otherDevices = currentDevice
        ? visibleDevices.filter(device => device.id !== currentDevice.id)
        : visibleDevices;
    const selectOutputDevice = (device: Device) => {
        if (!device.outputPluginId || !device.outputDevice) return;

        if (device.outputPluginId === GOOGLE_CAST_OUTPUT_PLUGIN_ID) {
            void openCastDevicePicker();
            return;
        }

        player.selectOutputDevice(device.outputPluginId, device.outputDevice);
        setDevices(currentDevices => currentDevices.map(currentDevice => ({
            ...currentDevice,
            selected:
                currentDevice.outputPluginId === device.outputPluginId &&
                currentDevice.outputDevice?.device_identifier === device.outputDevice?.device_identifier &&
                currentDevice.outputDevice?.device_type === device.outputDevice?.device_type,
        })));
    };

    const openCastDevicePicker = async () => {
        if (castPickerLoading) return;

        setCastPickerLoading(true);

        try {
            await selectGoogleCastOutput();
        } catch (error) {
            console.error('Failed to select Google Cast output', error);
        } finally {
            setCastPickerLoading(false);
        }
    };

    return (
        <div className='devices-view-container'>
            <h1 className='devices-view-title'>{t('devices.title')}</h1>
            {syncedPlaybackInfo && (
                <div className='devices-playing-on'>
                    <span className='devices-playing-on-label'>{t('devices.playing_on')}</span>
                    <span className='devices-playing-on-device'>{syncedPlaybackInfo.deviceLabel}</span>
                </div>
            )}
            {devicesLoading ? (
                <div className='devices-loading' aria-label={t('devices.loading')}>
                    <LoaderCircle />
                </div>
            ) : (
                <div className='devices-list'>
                    {currentDevice && (
                        <div className='devices-current'>
                            <DeviceItem
                                device={currentDevice}
                                current
                                onSelect={currentDevice.outputDevice ? selectOutputDevice : undefined}
                            />
                        </div>
                    )}
                    {otherDevices.length ? otherDevices.map((device) => (
                        <DeviceItem
                            key={device.id ?? device.identifier}
                            device={device}
                            onSelect={device.outputDevice ? selectOutputDevice : undefined}
                        />
                    )) : !currentDevice ? (
                        <span className='devices-empty'>{t('devices.empty')}</span>
                    ) : null}
                    <button
                        className='devices-find-cast-button'
                        type='button'
                        onClick={() => void openCastDevicePicker()}
                        disabled={castPickerLoading}
                    >
                        {castPickerLoading ? (
                            <LoaderCircle className='devices-find-cast-icon devices-find-cast-icon-loading' />
                        ) : (
                            <Cast className='devices-find-cast-icon' />
                        )}
                        <span>{t('devices.select_cast_device')}</span>
                    </button>
                </div>
            )}
        </div>
    )
}

export {
    getDevicesVisibleState,
    readStoredSideTabWidth,
    setDevicesVisibleState,
    setSideTabWidth,
    subscribeDevicesVisibleState,
    subscribeSideTabWidth,
    toggleDevicesVisibleState,
} from './devicesState';

export default Devices
