import type { SourcePlugin, TrackMetadata } from '../../modules/player';
import { getVolumeStorage } from '../../modules/player';
import { sdkPlay, sdkPause, sdkResume, sdkSeek, sdkSetVolume, sdkActivateElement, onStateChange, getState, startVolumePolling, stopVolumePolling } from './sdk';
import type { SpotifyState } from './sdk';

const VOLUME_STORAGE_KEY = 'player_volume';
const SPOTIFY_STATE_TIMEOUT_MS = 12000;

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

        const timer = setTimeout(() => {
            unsub?.();
            reject(new Error('Timed out waiting for Spotify playback state'));
        }, SPOTIFY_STATE_TIMEOUT_MS);

        unsub = onStateChange(state => {
            if (!state) return;

            const track = state.track_window?.current_track;
            if (track?.id !== songId) return;

            clearTimeout(timer);
            onReadyState(state);
            unsub?.();
            resolve();
        });
    });
}

export default class SpotifySourcePlugin implements SourcePlugin {
    private unsubscribe: (() => void) | null = null;
    private ticker: ReturnType<typeof setInterval> | null = null;

    private lastPosition = 0;
    private lastPositionAt = 0;

    private _isPlaying = false;
    private _volume = 1;

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
        callbacks: {
            onMetadata: (meta: TrackMetadata) => void;
            onReady: () => void;
            onStateChange: () => void;
        }
    ) {
        this.unsubscribe?.();
        this.stopTicker();

        try {
            await timeout(
                sdkPlay(songId),
                SPOTIFY_STATE_TIMEOUT_MS,
                'Timed out waiting for Spotify Web Playback SDK readiness'
            );
        } catch (error) {
            console.error('[spotify@built-in] Spotify is unavailable or failed to start playback.', error);
            throw error;
        }

        await sdkSetVolume(this._volume);

        if (!autoplay) await sdkPause();

        await waitForSpotifyTrackState(songId, state => {
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

            startVolumePolling(async (v: number) => {
                this._volume = v;
                const storage = getVolumeStorage();
                storage?.setItem(VOLUME_STORAGE_KEY, String(v));
                callbacks.onStateChange();
            }, window.sdkPlayer);
        });

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
    resume() { sdkResume().catch(error => console.warn('[spotify@built-in] Failed to resume Spotify playback.', error)); }
    activate() { sdkActivateElement()?.catch(error => console.warn('[spotify@built-in] Failed to activate Spotify player.', error)); }
    seek(seconds: number) { sdkSeek(seconds * 1000).catch(error => console.warn('[spotify@built-in] Failed to seek Spotify playback.', error)); }

    setVolume(fraction: number) {
        this._volume = fraction;
        sdkSetVolume(fraction);
        const storage = getVolumeStorage();
        storage?.setItem(VOLUME_STORAGE_KEY, String(fraction));
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
        stopVolumePolling();
        sdkPause();
    }
}
