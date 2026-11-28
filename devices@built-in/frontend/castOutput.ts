import {
    player,
    type AudioOutputPlaybackRequest,
    type AudioOutputPlugin,
    type AudioOutputPluginCallbacks,
} from '@omniplayr/plugins';
import {
    disconnectGoogleCast,
    getGoogleCastDevice,
    getGoogleCastPlaybackState,
    initGoogleCastSdk,
    isGoogleCastAvailable,
    loadGoogleCastMedia,
    pauseGoogleCast,
    requestGoogleCastSession,
    resumeGoogleCast,
    seekGoogleCast,
    setGoogleCastVolume,
    stopGoogleCast,
    subscribeGoogleCastPlayback,
} from './castSdk';

export { OUTPUT_DEVICES_CHANGED_EVENT } from './castSdk';

export const GOOGLE_CAST_OUTPUT_PLUGIN_ID = 'devices@built-in';

let activeCallbacks: AudioOutputPluginCallbacks | null = null;
let registered = false;
let playbackSubscriptionAttached = false;
let castPlaybackStarted = false;
let castEndedHandled = false;

type AudioOutputPluginWithCanPlay = AudioOutputPlugin & {
    canPlay?: (request: AudioOutputPlaybackRequest) => boolean | string;
};

function attachPlaybackSubscription() {
    if (playbackSubscriptionAttached) return;

    playbackSubscriptionAttached = true;
    subscribeGoogleCastPlayback(state => {
        activeCallbacks?.onStateChange();

        if (
            state.playerState === 'PLAYING' ||
            state.playerState === 'PAUSED'
        ) {
            castPlaybackStarted = true;
            castEndedHandled = false;
        }

        if (
            state.playerState === 'IDLE' &&
            castPlaybackStarted &&
            !castEndedHandled
        ) {
            castEndedHandled = true;
            castPlaybackStarted = false;
            activeCallbacks?.onEnded();
        }
    });
}

const googleCastOutput: AudioOutputPluginWithCanPlay = {
    listDevices() {
        return isGoogleCastAvailable() ? [getGoogleCastDevice()] : [];
    },

    canPlay(request: AudioOutputPlaybackRequest) {
        if (request.sourceType === 'spotify') {
            return 'Spotify cannot be played through this output because the Spotify Web Playback SDK does not expose a castable audio stream.';
        }

        if (!request.streamUrl) return request.metadata === null;

        return Boolean(request.streamUrl);
    },

    async play(request: AudioOutputPlaybackRequest, callbacks: AudioOutputPluginCallbacks) {
        activeCallbacks = callbacks;
        castPlaybackStarted = false;
        castEndedHandled = false;

        await loadGoogleCastMedia({
            streamUrl: request.streamUrl,
            contentType: request.contentType ?? undefined,
            currentTime: player.currentTime || 0,
            metadata: request.metadata ? {
                title: request.metadata.title ?? undefined,
                artist: request.metadata.artist ?? undefined,
                album: request.metadata.album ?? undefined,
                album_art: request.metadata.album_art ?? undefined,
            } : undefined,
        });

        callbacks.onReady();
        callbacks.onStateChange();
    },

    pause() {
        pauseGoogleCast();
    },

    resume() {
        resumeGoogleCast();
    },

    seek(seconds: number) {
        seekGoogleCast(seconds);
    },

    setVolume(fraction: number) {
        setGoogleCastVolume(fraction);
    },

    stop() {
        castPlaybackStarted = false;
        castEndedHandled = true;
        stopGoogleCast();
        disconnectGoogleCast();
        activeCallbacks = null;
    },

    getCurrentTime() {
        return getGoogleCastPlaybackState().currentTime;
    },

    getDuration() {
        return getGoogleCastPlaybackState().duration;
    },

    isPlaying() {
        return getGoogleCastPlaybackState().isPlaying;
    },
};

export async function selectGoogleCastOutput() {
    await requestGoogleCastSession();

    const device = getGoogleCastDevice();
    player.selectOutputDevice(GOOGLE_CAST_OUTPUT_PLUGIN_ID, device);

    return device;
}

export function initGoogleCastOutput() {
    if (registered) return;

    registered = true;
    attachPlaybackSubscription();
    player.registerOutputPlugin(GOOGLE_CAST_OUTPUT_PLUGIN_ID, googleCastOutput);

    void initGoogleCastSdk().catch(error => {
        console.warn('Google Cast output is unavailable', error);
    });
}
