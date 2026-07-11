import {
    api,
    getVolumeStorage,
    type SourcePlugin,
    type TrackMetadata
} from '@omniplayr/plugins';
import { sdkPlay, sdkPause, sdkResume, sdkSeek, sdkSetVolume, sdkActivateElement, onStateChange, getState, waitReady as sdkWaitReady } from './sdk';
import type { SpotifyState } from './sdk';

const VOLUME_STORAGE_KEY = 'player_volume';
const SPOTIFY_STATE_TIMEOUT_MS = 12000;

type PlaybackCallbacks = {
    onMetadata: (meta: TrackMetadata) => void;
    onReady: () => void;
    onStateChange: () => void;
};

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function waitForSpotifyTrackState(
    songId: string,
    onReadyState: (state: SpotifyState) => void
): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let unsub: (() => void) | null = null;
        let settled = false;

        const finish = (state: SpotifyState) => {
            if (settled) return;

            const track = state.track_window?.current_track;
            if (track?.id !== songId) return;

            settled = true;
            clearTimeout(timer);
            clearInterval(pollTimer);
            unsub?.();
            onReadyState(state);
            resolve();
        };

        const timer = setTimeout(() => {
            settled = true;
            clearInterval(pollTimer);
            unsub?.();
            reject(new Error('Timed out waiting for Spotify playback state'));
        }, SPOTIFY_STATE_TIMEOUT_MS);

        const pollTimer = setInterval(() => {
            const state = getState();
            if (state) finish(state);
        }, 250);

        unsub = onStateChange(state => {
            if (state) finish(state);
        });

        const currentState = getState();
        if (currentState) finish(currentState);
    });
}

export default class SpotifySourcePlugin implements SourcePlugin {
    private unsubscribe: (() => void) | null = null;
    private ticker: ReturnType<typeof setInterval> | null = null;

    private lastPosition = 0;
    private lastPositionAt = 0;

    private _isPlaying = false;
    private _volume = 1;
    private transientVolumeActive = false;
    private pendingSongId: string | null = null;
    private playbackCallbacks: PlaybackCallbacks | null = null;

    constructor() {
        const storage = getVolumeStorage();
        const raw = storage?.getItem(VOLUME_STORAGE_KEY) ?? null;
        const parsed = raw !== null ? parseFloat(raw) : NaN;
        if (!isNaN(parsed)) this._volume = Math.max(0, Math.min(1, parsed));
    }

    private startTicker(onTick: () => void) {
        if (this.ticker) return;

        this.ticker = setInterval(() => {
            onTick();
        }, 250);
    }

    private stopTicker() {
        if (this.ticker) {
            clearInterval(this.ticker);
            this.ticker = null;
        }
    }

    async play(
        songId: string,
        _extra: Record<string, unknown> | undefined,
        autoplay: boolean,
        callbacks: PlaybackCallbacks
    ) {
        this.unsubscribe?.();
        this.stopTicker();
        this.playbackCallbacks = callbacks;

        if (!autoplay) {
            const encoded = encodeURIComponent(songId);
            const result = await api(`/player/media/spotify:${encoded}`) as { metadata: TrackMetadata };
            this.pendingSongId = songId;
            this._isPlaying = false;
            callbacks.onMetadata(result.metadata);
            callbacks.onReady();
            callbacks.onStateChange();
            return;
        }

        this.pendingSongId = null;

        try {
            await timeout(
                sdkWaitReady(),
                SPOTIFY_STATE_TIMEOUT_MS,
                'Timed out waiting for Spotify Web Playback SDK readiness'
            );

            await timeout(
                sdkPlay(songId),
                SPOTIFY_STATE_TIMEOUT_MS,
                'Timed out asking Spotify to start playback'
            );
        } catch (error) {
            console.error('[spotify@built-in] Spotify is unavailable or failed to start playback.', error);
            throw error;
        }

        const applyReadyState = (state: SpotifyState) => {
            const track = state.track_window?.current_track;
            if (!track) return;

            callbacks.onMetadata({
                title: track.name,
                artist: track.artists.map((a: { name: string }) => a.name).join(', '),
                album: track.album.name,
                album_art: track.album.images[0]?.url ?? null,
                duration: state.duration / 1000,
                genre: null,
                year: null,
                filename: null,
            });

            callbacks.onReady();
        };

        try {
            await waitForSpotifyTrackState(songId, applyReadyState);
        } catch (error) {
            if (!(error instanceof Error) || error.message !== 'Timed out waiting for Spotify playback state') {
                throw error;
            }

            await timeout(
                sdkWaitReady(),
                SPOTIFY_STATE_TIMEOUT_MS,
                'Timed out waiting for Spotify Web Playback SDK to reconnect'
            );
            await timeout(
                sdkPlay(songId),
                SPOTIFY_STATE_TIMEOUT_MS,
                'Timed out retrying Spotify playback'
            );
            await waitForSpotifyTrackState(songId, applyReadyState);
        }

        await sdkSetVolume(this._volume);

        this.unsubscribe = onStateChange(state => {
            if (!state) return;

            this.lastPosition = state.position;
            this.lastPositionAt = Date.now();
            this._isPlaying = !state.paused;

            if (!state.paused) {
                this.startTicker(callbacks.onStateChange);
            } else {
                this.stopTicker();
            }

            callbacks.onStateChange();
        });
    }

    pause() { sdkPause().catch(error => console.warn('[spotify@built-in] Failed to pause Spotify playback.', error)); }
    resume() {
        if (this.pendingSongId && this.playbackCallbacks) {
            const songId = this.pendingSongId;
            this.pendingSongId = null;
            this.play(songId, undefined, true, this.playbackCallbacks)
                .catch(error => console.warn('[spotify@built-in] Failed to start restored Spotify playback.', error));
            return;
        }
        sdkResume().catch(error => console.warn('[spotify@built-in] Failed to resume Spotify playback.', error));
    }
    activate() { sdkActivateElement()?.catch(error => console.warn('[spotify@built-in] Failed to activate Spotify player.', error)); }
    seek(seconds: number) { sdkSeek(seconds * 1000).catch(error => console.warn('[spotify@built-in] Failed to seek Spotify playback.', error)); }

    setVolume(fraction: number) {
        this.transientVolumeActive = false;
        this._volume = fraction;
        sdkSetVolume(fraction).catch(error => console.warn('[spotify@built-in] Failed to set Spotify volume.', error));
        const storage = getVolumeStorage();
        storage?.setItem(VOLUME_STORAGE_KEY, String(fraction));
    }

    setTransientVolume(fraction: number) {
        const clamped = Math.max(0, Math.min(1, fraction));
        this.transientVolumeActive = Math.abs(clamped - this._volume) > 0.001;
        sdkSetVolume(clamped).catch(error => console.warn('[spotify@built-in] Failed to set transient Spotify volume.', error));
    }

    getVolume() {
        return this._volume;
    }

    getCurrentTime() {
        if (!this._isPlaying) return this.lastPosition / 1000;
        return (this.lastPosition + (Date.now() - this.lastPositionAt)) / 1000;
    }

    getDuration() {
        return (getState()?.duration ?? 0) / 1000;
    }

    isPlaying() {
        return this._isPlaying;
    }

    destroy() {
        this.unsubscribe?.();
        this.stopTicker();
        this.pendingSongId = null;
        sdkPause().catch(error => console.warn('[spotify@built-in] Failed to pause Spotify playback during cleanup.', error));
    }
}
