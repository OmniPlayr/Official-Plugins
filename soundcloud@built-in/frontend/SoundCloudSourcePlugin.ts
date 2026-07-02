import { getTrack } from './auth';
import { destroyWidget, getWidget } from './widget';

import {
    getVolumeStorage,
    type SourcePlugin,
    type TrackMetadata,
} from '@omniplayr/plugins';

const VOLUME_STORAGE_KEY = 'player_volume';
const STATE_TIMEOUT_MS = 12000;

function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeMetadata(raw: Record<string, unknown>): TrackMetadata {
    return {
        title: typeof raw.title === 'string' ? raw.title : null,
        artist: typeof raw.artist === 'string' ? raw.artist : null,
        album: typeof raw.album === 'string' ? raw.album : null,
        album_art: typeof raw.album_art === 'string' ? raw.album_art : null,
        duration: typeof raw.duration === 'number' ? raw.duration : 0,
        genre: typeof raw.genre === 'string' ? raw.genre : null,
        year: typeof raw.year === 'string' ? raw.year : null,
        filename: null,
    };
}

export default class SoundCloudSourcePlugin implements SourcePlugin {
    private ticker: ReturnType<typeof setInterval> | null = null;
    private _isPlaying = false;
    private _volume = 1;
    private _duration = 0;
    private _position = 0;
    private currentTrackId: string | null = null;

    constructor() {
        const storage = getVolumeStorage();
        const raw = storage?.getItem(VOLUME_STORAGE_KEY) ?? null;
        const parsed = raw !== null ? parseFloat(raw) : NaN;
        if (!isNaN(parsed)) this._volume = Math.max(0, Math.min(1, parsed));
    }

    private startTicker(onTick: () => void) {
        if (this.ticker) return;
        this.ticker = setInterval(async () => {
            const widget = await getWidget();
            widget.getPosition(position => { this._position = position / 1000; });
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
        this.currentTrackId = songId;
        this.stopTicker();
        const [{ url, metadata }, widget] = await Promise.all([getTrack(songId), getWidget()]);
        const events = window.SC?.Widget.Events;
        if (!events) throw new Error('SoundCloud Widget API is unavailable');

        widget.unbind(events.PLAY);
        widget.unbind(events.PAUSE);
        widget.unbind(events.FINISH);
        widget.unbind(events.PLAY_PROGRESS);

        let ready = false;
        const timeoutAt = Date.now() + STATE_TIMEOUT_MS;

        await new Promise<void>((resolve, reject) => {
            widget.load(url, {
                auto_play: autoplay,
                callback: () => {
                    widget.setVolume(Math.round(this._volume * 100));
                    widget.getDuration(duration => { this._duration = duration / 1000; });
                    callbacks.onMetadata(normalizeMetadata(metadata));
                    callbacks.onReady();
                    ready = true;
                    resolve();
                },
            });

            const timer = setInterval(() => {
                if (ready) {
                    clearInterval(timer);
                    return;
                }
                if (Date.now() > timeoutAt) {
                    clearInterval(timer);
                    reject(new Error('Timed out waiting for SoundCloud playback readiness'));
                }
            }, 250);
        });

        widget.bind(events.PLAY, () => {
            this._isPlaying = true;
            this.startTicker(callbacks.onStateChange);
            callbacks.onStateChange();
        });
        widget.bind(events.PAUSE, () => {
            this._isPlaying = false;
            this.stopTicker();
            callbacks.onStateChange();
        });
        widget.bind(events.FINISH, () => {
            this._isPlaying = false;
            this.stopTicker();
            callbacks.onStateChange();
        });
        widget.bind(events.PLAY_PROGRESS, payload => {
            if (payload?.currentPosition !== undefined) this._position = payload.currentPosition / 1000;
            callbacks.onStateChange();
        });

        if (autoplay) {
            this._isPlaying = true;
            this.startTicker(callbacks.onStateChange);
            callbacks.onStateChange();
        } else {
            await wait(50);
            widget.pause();
        }
    }

    async pause() {
        const widget = await getWidget();
        widget.pause();
    }

    async resume() {
        const widget = await getWidget();
        widget.play();
    }

    activate() {}

    async seek(seconds: number) {
        const widget = await getWidget();
        widget.seekTo(seconds * 1000);
    }

    async setVolume(fraction: number) {
        this._volume = Math.max(0, Math.min(1, fraction));
        const storage = getVolumeStorage();
        storage?.setItem(VOLUME_STORAGE_KEY, String(this._volume));
        const widget = await getWidget();
        widget.setVolume(Math.round(this._volume * 100));
    }

    getVolume() {
        return this._volume;
    }

    getCurrentTime() {
        return this._position;
    }

    getDuration() {
        return this._duration;
    }

    isPlaying() {
        return this._isPlaying;
    }

    destroy() {
        this.stopTicker();
        if (this.currentTrackId) {
            getWidget().then(widget => widget.pause()).catch(() => {});
        }
        destroyWidget();
    }
}
