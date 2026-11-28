import { getPluginConfig } from '@omniplayr/plugins';
import type {
    CastFramework,
    ChromeCastApi,
    GoogleCastDevice,
    GoogleCastMediaRequest,
    GoogleCastPlaybackState,
} from './castTypes';

const PLUGIN_KEY = 'devices@built-in';
const CAST_SENDER_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
const DEFAULT_RECEIVER_APP_ID = 'CC1AD845';

export const OUTPUT_DEVICES_CHANGED_EVENT = 'devices@built-in:output-devices-changed';

let castScriptLoading: Promise<void> | null = null;
let castReady = false;
let castState = 'UNKNOWN';
let castContext: ReturnType<CastFramework['CastContext']['getInstance']> | null = null;
let remotePlayer: InstanceType<CastFramework['RemotePlayer']> | null = null;
let remoteController: InstanceType<CastFramework['RemotePlayerController']> | null = null;
const playbackListeners = new Set<(state: GoogleCastPlaybackState) => void>();

function castEnabled() {
    return getPluginConfig<boolean>(PLUGIN_KEY, 'devices.google_cast_enabled', true) !== false;
}

function receiverAppId() {
    const configured = getPluginConfig<string>(
        PLUGIN_KEY,
        'devices.google_cast_receiver_app_id',
        DEFAULT_RECEIVER_APP_ID,
    );

    return configured || DEFAULT_RECEIVER_APP_ID;
}

function emitDevicesChanged() {
    window.dispatchEvent(new Event(OUTPUT_DEVICES_CHANGED_EVENT));
}

function playbackState(): GoogleCastPlaybackState {
    return {
        currentTime: remotePlayer?.currentTime ?? 0,
        duration: remotePlayer?.duration ?? 0,
        isPlaying: remotePlayer ? !remotePlayer.isPaused : false,
        playerState: remotePlayer?.playerState,
    };
}

function emitPlaybackChanged() {
    const state = playbackState();
    playbackListeners.forEach(listener => listener(state));
}

function loadCastSender() {
    if (castScriptLoading) return castScriptLoading;

    castScriptLoading = new Promise((resolve, reject) => {
        const previousCallback = window.__onGCastApiAvailable;

        window.__onGCastApiAvailable = isAvailable => {
            previousCallback?.(isAvailable);

            if (isAvailable) {
                resolve();
            } else {
                castScriptLoading = null;
                reject(new Error('Google Cast sender API is unavailable'));
            }
        };

        const existingScript = document.querySelector<HTMLScriptElement>(
            `script[src="${CAST_SENDER_URL}"]`,
        );

        if (existingScript) return;

        const script = document.createElement('script');
        script.src = CAST_SENDER_URL;
        script.async = true;
        script.onerror = () => {
            castScriptLoading = null;
            reject(new Error('Failed to load Google Cast sender API'));
        };
        document.head.appendChild(script);
    });

    return castScriptLoading;
}

function updateCastState(nextState?: string) {
    castState = nextState || castState;
    emitDevicesChanged();
}

function initCastFramework() {
    if (castReady) return;

    const castFramework = window.cast?.framework;
    const chromeCast = window.chrome?.cast;

    if (!castFramework || !chromeCast) {
        throw new Error('Google Cast framework did not initialize');
    }

    castContext = castFramework.CastContext.getInstance();
    castContext.setOptions({
        receiverApplicationId: receiverAppId(),
        autoJoinPolicy: chromeCast.AutoJoinPolicy.ORIGIN_SCOPED,
    });

    castContext.addEventListener(
        castFramework.CastContextEventType.CAST_STATE_CHANGED,
        event => updateCastState(event.castState),
    );
    castContext.addEventListener(
        castFramework.CastContextEventType.SESSION_STATE_CHANGED,
        () => {
            updateCastState();
            emitPlaybackChanged();
        },
    );

    remotePlayer = new castFramework.RemotePlayer();
    remoteController = new castFramework.RemotePlayerController(remotePlayer);

    Object.values(castFramework.RemotePlayerEventType).forEach(eventType => {
        remoteController?.addEventListener(eventType, emitPlaybackChanged);
    });

    castReady = true;
    emitDevicesChanged();
}

async function ensureGoogleCastReady() {
    if (!castEnabled()) {
        throw new Error('Google Cast is disabled');
    }

    await loadCastSender();

    if (!castReady) {
        initCastFramework();
    }

    if (!castContext) {
        throw new Error('Google Cast is not ready');
    }

    return castContext;
}

function normalizeStreamUrl(streamUrl: string) {
    const url = new URL(streamUrl, window.location.href);

    if (
        url.hostname === 'localhost' ||
        url.hostname === '127.0.0.1' ||
        url.hostname === '::1'
    ) {
        url.hostname = window.location.hostname;
    }

    if (url.protocol === 'https:' && isLocalNetworkHost(url.hostname)) {
        url.protocol = 'http:';
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`Google Cast cannot load this stream protocol: ${url.protocol}`);
    }

    return url.href;
}

function isLocalNetworkHost(hostname: string) {
    const clean = hostname.replace(/^\[|\]$/g, '');

    return (
        clean === window.location.hostname ||
        clean === 'localhost' ||
        clean === '127.0.0.1' ||
        clean === '::1' ||
        /^10\./.test(clean) ||
        /^192\.168\./.test(clean) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(clean)
    );
}

function resolveContentType(streamUrl: string, contentType?: string) {
    if (contentType) return contentType;

    const pathname = new URL(streamUrl).pathname.toLowerCase();

    if (pathname.endsWith('.m3u8')) return 'application/x-mpegURL';
    if (pathname.endsWith('.aac')) return 'audio/aac';
    if (pathname.endsWith('.flac')) return 'audio/flac';
    if (pathname.endsWith('.ogg') || pathname.endsWith('.oga')) return 'audio/ogg';
    if (pathname.endsWith('.wav')) return 'audio/wav';
    if (pathname.endsWith('.webm')) return 'audio/webm';
    if (pathname.endsWith('.mp4') || pathname.endsWith('.m4a')) return 'audio/mp4';

    return 'audio/mpeg';
}

export async function initGoogleCastSdk() {
    if (!castEnabled()) return;

    await ensureGoogleCastReady();
}

export async function requestGoogleCastSession() {
    const context = await ensureGoogleCastReady();
    const session = context.getCurrentSession() || await context.requestSession();

    updateCastState();
    return session;
}

export function getGoogleCastDevice(): GoogleCastDevice {
    return {
        device_identifier: 'google-cast',
        device_type: 'google-cast',
        label:
            castContext
                ?.getCurrentSession()
                ?.getSessionObj?.()
                ?.receiver?.friendlyName || 'Choose Google Cast device',
    };
}

export function isGoogleCastAvailable() {
    const castFramework = window.cast?.framework;

    if (!castReady || !castFramework) return false;
    if (castContext?.getCurrentSession()) return true;

    return castState !== castFramework.CastState.NO_DEVICES_AVAILABLE;
}

export async function loadGoogleCastMedia(request: GoogleCastMediaRequest) {
    const chromeCast = window.chrome?.cast;
    const session = await requestGoogleCastSession();

    if (!chromeCast) {
        throw new Error('Google Cast media API is unavailable');
    }

    const streamUrl = normalizeStreamUrl(request.streamUrl);
    const contentType = resolveContentType(streamUrl, request.contentType);
    const mediaInfo = new chromeCast.media.MediaInfo(streamUrl, contentType);
    const metadata = new chromeCast.media.MusicTrackMediaMetadata();

    metadata.title = request.metadata?.title || undefined;
    metadata.artist = request.metadata?.artist || undefined;
    metadata.albumName = request.metadata?.album || undefined;

    if (
        request.metadata?.album_art &&
        !request.metadata.album_art.startsWith('data:')
    ) {
        metadata.images = [{ url: normalizeStreamUrl(request.metadata.album_art) }];
    }

    mediaInfo.contentUrl = streamUrl;
    mediaInfo.metadata = metadata;
    mediaInfo.streamType = chromeCast.media.StreamType.BUFFERED;

    const loadRequest = new chromeCast.media.LoadRequest(mediaInfo);
    loadRequest.autoplay = true;
    loadRequest.currentTime = Math.max(0, request.currentTime || 0);

    console.debug('Loading Google Cast media', {
        streamUrl,
        contentType,
        currentTime: loadRequest.currentTime,
    });

    try {
        await session.loadMedia(loadRequest);
    } catch (error) {
        console.error('Google Cast failed to load media', {
            streamUrl,
            contentType,
            error,
        });
        throw error;
    }
}

function currentMediaSession() {
    return castContext?.getCurrentSession()?.getMediaSession?.() ?? null;
}

export function pauseGoogleCast() {
    const chromeCast = window.chrome?.cast;
    if (!chromeCast) return;

    currentMediaSession()?.pause?.(new chromeCast.media.PauseRequest());
}

export function resumeGoogleCast() {
    const chromeCast = window.chrome?.cast;
    if (!chromeCast) return;

    currentMediaSession()?.play?.(new chromeCast.media.PlayRequest());
}

export function seekGoogleCast(seconds: number) {
    const chromeCast = window.chrome?.cast;
    if (!chromeCast) return;

    const request = new chromeCast.media.SeekRequest();
    request.currentTime = Math.max(0, seconds);
    currentMediaSession()?.seek?.(request);
}

export function setGoogleCastVolume(fraction: number) {
    if (!remotePlayer || !remoteController?.setVolumeLevel) return;

    remotePlayer.volumeLevel = Math.max(0, Math.min(1, fraction));
    remoteController.setVolumeLevel();
}

export function stopGoogleCast() {
    currentMediaSession()?.stop?.();
}

export function getGoogleCastPlaybackState() {
    return playbackState();
}

export function subscribeGoogleCastPlayback(
    listener: (state: GoogleCastPlaybackState) => void,
) {
    playbackListeners.add(listener);

    return () => {
        playbackListeners.delete(listener);
    };
}

export function disconnectGoogleCast() {
    castContext?.getCurrentSession()?.endSession?.(true);
}
