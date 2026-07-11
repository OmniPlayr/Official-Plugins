import type { QueueItem } from '@omniplayr/plugins';

export type SongMetadata = {
    title?: string | null;
    artist?: string | null;
    album?: string | null;
    album_art?: string | null | unknown;
    filename?: string | null;
};
export type QueueSong = {
    item: QueueItem;
    metadata: SongMetadata | null;
};