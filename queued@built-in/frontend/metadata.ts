import { api, player, type QueueItem } from '@omniplayr/plugins';
import type { QueueSong, SongMetadata } from './types';

export const songMetadataCache = new Map<string, SongMetadata | null>();
const songMetadataRequests = new Map<string, Promise<SongMetadata | null>>();

async function getMetadata(songId: string, sourceType: string) {
    return api(`/player/media/${sourceType}:${encodeURIComponent(songId)}`) as Promise<{ metadata?: SongMetadata | null }>;
}

export function songMetadataKey(item: QueueItem) {
    return `${item.sourceType}:${item.songId}`;
}

export async function getCachedMetadata(item: QueueItem) {
    const key = songMetadataKey(item);
    if (songMetadataCache.has(key)) return songMetadataCache.get(key) ?? null;
    if (songMetadataRequests.has(key)) return songMetadataRequests.get(key)!;

    const request = getMetadata(item.songId, item.sourceType)
        .then((media) => normalizeMetadata(media.metadata))
        .catch(() => null)
        .then((metadata) => {
            songMetadataCache.set(key, metadata);
            return metadata;
        })
        .finally(() => {
            songMetadataRequests.delete(key);
        });

    songMetadataRequests.set(key, request);
    return request;
}

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

export function currentQueueSong(): QueueSong | null {
    if (!player.currentSongId || !player.currentSourceType) return null;

    const item: QueueItem = {
        songId: player.currentSongId,
        sourceType: player.currentSourceType,
        extra: player.currentExtra ?? undefined,
    };

    return {
        item,
        metadata: normalizeMetadata(player.currentMetadata) ?? metadataFromQueueItem(item),
    };
}
