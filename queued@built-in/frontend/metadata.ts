import { player, type QueueItem } from '@omniplayr/plugins';
import type { QueueSong, SongMetadata } from './types';

function isAssetReference(value: unknown): value is { asset_id: unknown } {
    return Boolean(value && typeof value === 'object' && 'asset_id' in value);
}

function resolveImage(value: unknown, imageAssets?: Map<string, string>) {
    if (typeof value === 'string') return value;
    if (!isAssetReference(value)) return null;
    return imageAssets?.get(String(value.asset_id)) ?? null;
}

export function normalizeMetadata(metadata: SongMetadata | null | undefined, imageAssets?: Map<string, string>): SongMetadata | null {
    if (!metadata) return null;

    return {
        ...metadata,
        album_art: resolveImage(metadata.album_art, imageAssets),
    };
}

export function metadataFromQueueItem(item: QueueItem): SongMetadata | null {
    const extra = item.extra ?? {};
    const title = typeof extra.title === 'string' ? extra.title : null;
    const artist = typeof extra.artist === 'string' ? extra.artist : null;
    const albumArt = typeof extra.albumArt === 'string'
        ? extra.albumArt
        : typeof extra.album_art === 'string'
            ? extra.album_art
            : null;

    if (!title && !artist && !albumArt) return null;

    return {
        title,
        artist,
        album_art: albumArt,
    };
}

export function metadataForQueueItem(item: QueueItem): SongMetadata | null {
    const fallback = metadataFromQueueItem(item);
    const provided = normalizeMetadata(item.metadata);

    if (!provided) return fallback;

    const filled = Object.fromEntries(
        Object.entries(provided).filter(([, value]) => value !== null && value !== undefined)
    );

    return { ...fallback, ...filled };
}

export function toQueueSong(item: QueueItem): QueueSong {
    return {
        item,
        metadata: metadataForQueueItem(item),
    };
}

export function currentQueueSong(): QueueSong | null {
    if (!player.currentSongId || !player.currentSourceType) return null;

    return toQueueSong({
        songId: player.currentSongId,
        sourceType: player.currentSourceType,
        extra: player.currentExtra ?? undefined,
        metadata: player.currentMetadata,
    });
}