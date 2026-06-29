declare global {
    interface Window {
        SC?: {
            Widget: {
                (iframe: HTMLIFrameElement): SoundCloudWidget;
                Events: {
                    READY: string;
                    PLAY: string;
                    PAUSE: string;
                    FINISH: string;
                    PLAY_PROGRESS: string;
                };
            };
        };
    }
}

export interface SoundCloudSound {
    title?: string;
    user?: { username?: string; avatar_url?: string };
    artwork_url?: string;
    duration?: number;
    genre?: string;
}

export interface SoundCloudWidget {
    bind(event: string, cb: (payload?: { currentPosition?: number }) => void): void;
    unbind(event: string): void;
    load(url: string, options: { auto_play?: boolean; callback?: () => void }): void;
    play(): void;
    pause(): void;
    seekTo(ms: number): void;
    setVolume(volume: number): void;
    getDuration(cb: (duration: number) => void): void;
    getPosition(cb: (position: number) => void): void;
    getCurrentSound(cb: (sound: SoundCloudSound) => void): void;
    isPaused(cb: (paused: boolean) => void): void;
}

let loadPromise: Promise<void> | null = null;
let widget: SoundCloudWidget | null = null;
let iframe: HTMLIFrameElement | null = null;

export function loadWidgetApi(): Promise<void> {
    if (window.SC?.Widget) return Promise.resolve();
    if (loadPromise) return loadPromise;

    loadPromise = new Promise((resolve, reject) => {
        const existing = document.getElementById('soundcloud-widget-api') as HTMLScriptElement | null;
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('SoundCloud Widget API failed to load')), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.id = 'soundcloud-widget-api';
        script.src = 'https://w.soundcloud.com/player/api.js';
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('SoundCloud Widget API failed to load'));
        document.head.appendChild(script);
    });

    return loadPromise;
}

export async function getWidget(): Promise<SoundCloudWidget> {
    await loadWidgetApi();
    if (widget) return widget;
    if (!window.SC?.Widget) throw new Error('SoundCloud Widget API is unavailable');

    iframe = document.createElement('iframe');
    iframe.id = 'soundcloud-player-widget';
    iframe.title = 'SoundCloud player';
    iframe.allow = 'autoplay';
    iframe.style.position = 'fixed';
    iframe.style.left = '-1px';
    iframe.style.top = '-1px';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.src = 'https://w.soundcloud.com/player/?url=https%3A//soundcloud.com&auto_play=false&show_artwork=false';
    document.body.appendChild(iframe);

    widget = window.SC.Widget(iframe);
    return widget;
}

export function destroyWidget() {
    iframe?.remove();
    iframe = null;
    widget = null;
}
