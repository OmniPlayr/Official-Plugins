import type { SourcePlugin, TrackMetadata } from '../../modules/player';
import { getVolumeStorage } from '../../modules/player';
import { sdkPlay, sdkPause, sdkResume, sdkSeek, sdkSetVolume, onStateChange, getState, startVolumePolling, stopVolumePolling } from './sdk';

const VOLUME_STORAGE_KEY = 'player_volume';

export default class SpotifySourcePlugin implements SourcePlugin {
    private unsubscribe: (() => void) | null = null;
    private ticker: ReturnType<typeof setInterval> | null = null;
    private currentTrackId: string | null = null;

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

        this.currentTrackId = songId;

        await sdkPlay(songId);

        sdkSetVolume(this._volume);

        if (!autoplay) sdkPause();

        await new Promise<void>(resolve => {
            const unsub = onStateChange(state => {
                if (!state) return;

                const track = state.track_window?.current_track;
                if (track?.id !== songId) return;

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
                }, (window as any).sdkPlayer);

                unsub();
                resolve();
            });
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

    pause() { sdkPause(); }
    resume() { sdkResume(); }
    seek(seconds: number) { sdkSeek(seconds * 1000); }

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