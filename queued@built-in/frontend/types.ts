import type { QueueItem } from '@omniplayr/plugins';

export type SongMetadata = {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    album_art?: string | null | unknown;
    filename?: string | null;
};

export type PlaylistSong = {
    source_type: string;
    song_id: string;
    position?: number;
    metadata?: SongMetadata;
};

export type QueueSong = {
    item: QueueItem;
    metadata: SongMetadata | null;
};

export type PlaylistQueueInfo = {
    service: string;
    id: string;
    name: string | null;
};

export type QueueSection = 'current' | 'priority' | 'next';

export type DragState = {
    section: QueueSection;
    index: number;
} | null;

export type DropTarget = {
    section: QueueSection;
    index: number;
    position: 'before' | 'after';
} | null;
