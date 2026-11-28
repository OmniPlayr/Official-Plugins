import type { AudioOutputDevice } from '@omniplayr/plugins';

export type CastSession = {
    loadMedia: (request: unknown) => Promise<unknown> | unknown;
    getMediaSession?: () => {
        pause?: (request?: unknown) => void;
        play?: (request?: unknown) => void;
        seek?: (request?: unknown) => void;
        stop?: (request?: unknown) => void;
    } | null;
    endSession?: (stopCasting: boolean) => void;
    getSessionObj?: () => {
        receiver?: {
            friendlyName?: string;
        };
    };
};

export type CastFramework = {
    CastContext: {
        getInstance: () => {
            setOptions: (options: unknown) => void;
            getCurrentSession: () => CastSession | null;
            requestSession: () => Promise<CastSession>;
            addEventListener: (
                type: string,
                listener: (event: { castState?: string; sessionState?: string }) => void,
            ) => void;
        };
    };
    CastContextEventType: {
        CAST_STATE_CHANGED: string;
        SESSION_STATE_CHANGED: string;
    };
    CastState: {
        NO_DEVICES_AVAILABLE: string;
    };
    RemotePlayer: new () => {
        currentTime?: number;
        duration?: number;
        isPaused?: boolean;
        playerState?: string;
        volumeLevel?: number;
    };
    RemotePlayerController: new (remotePlayer: unknown) => {
        addEventListener: (type: string, listener: () => void) => void;
        setVolumeLevel?: () => void;
    };
    RemotePlayerEventType: Record<string, string>;
};

export type ChromeCastApi = {
    AutoJoinPolicy: {
        ORIGIN_SCOPED: string;
    };
    media: {
        MediaInfo: new (contentId: string, contentType: string) => {
            metadata?: unknown;
            streamType?: string;
            contentUrl?: string;
        };
        LoadRequest: new (mediaInfo: unknown) => {
            autoplay?: boolean;
            currentTime?: number;
        };
        MusicTrackMediaMetadata: new () => {
            title?: string;
            artist?: string;
            albumName?: string;
            images?: Array<{ url: string }>;
        };
        PauseRequest: new () => unknown;
        PlayRequest: new () => unknown;
        SeekRequest: new () => {
            currentTime?: number;
        };
        StreamType: {
            BUFFERED: string;
        };
    };
};

export interface GoogleCastMediaRequest {
    streamUrl: string;
    contentType?: string;
    currentTime?: number;
    metadata?: {
        title?: string;
        artist?: string;
        album?: string;
        album_art?: string;
    };
}

export interface GoogleCastPlaybackState {
    currentTime: number;
    duration: number;
    isPlaying: boolean;
    playerState?: string;
}

export type GoogleCastDevice = AudioOutputDevice;

declare global {
    interface Window {
        __onGCastApiAvailable?: (isAvailable: boolean) => void;
        cast?: {
            framework?: CastFramework;
        };
        chrome?: {
            cast?: ChromeCastApi;
        };
    }
}
