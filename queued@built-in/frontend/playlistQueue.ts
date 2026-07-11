import { api, player, type QueueItem } from '@omniplayr/plugins';
import { metadataFromQueueItem, normalizeMetadata, songMetadataCache, songMetadataKey } from './metadata';
import type { PlaylistQueueInfo, PlaylistSong, QueueSong } from './types';

const playlistQueueCache = new Map<string, {
    playlistName: string | null;
    songs: Map<string, QueueSong>;
}>();

function playlistRouteId(info: PlaylistQueueInfo) {
    return info.service === 'local' ? info.id : `${info.id}:${info.service}`;
}

function playlistCacheKey(info: PlaylistQueueInfo) {
    return `${info.service}:${info.id}`;
}

function queueItemCacheKey(item: QueueItem, index: number) {
    const position = item.extra?.playlistPosition;
    return [
        item.sourceType,
        item.songId,
        position ?? '',
        index,
    ].join('\u0000');
}

function queueItemPayload(item: QueueItem) {
    return {
        source_type: item.sourceType,
        song_id: item.songId,
        position: item.extra?.playlistPosition,
        playlistPosition: item.extra?.playlistPosition,
    };
}

export function parsePlaylistQueue(queueName: string | null, items: QueueItem[]): PlaylistQueueInfo | null {
    const firstExtra = items[0]?.extra ?? player.currentExtra ?? {};
    const extraService = typeof firstExtra.playlistService === 'string' ? firstExtra.playlistService : null;
    const extraId = firstExtra.playlistId == null ? null : String(firstExtra.playlistId);
    const extraName = typeof firstExtra.playlistName === 'string' ? firstExtra.playlistName : null;

    if (queueName?.startsWith('playlist:')) {
        const [, service, ...idParts] = queueName.split(':');
        const id = idParts.join(':');

        if (service && id) {
            return {
                service,
                id,
                name: extraName,
            };
        }
    }

    if (extraService && extraId) {
        return {
            service: extraService,
            id: extraId,
            name: extraName,
        };
    }

    return null;
}

export async function getPlaylistQueueSongs(info: PlaylistQueueInfo, queueItems: QueueItem[]) {
    const cacheKey = playlistCacheKey(info);
    const cache = playlistQueueCache.get(cacheKey) ?? {
        playlistName: info.name,
        songs: new Map<string, QueueSong>(),
    };
    playlistQueueCache.set(cacheKey, cache);

    const missing = queueItems
        .map((item, index) => ({ item, index, key: queueItemCacheKey(item, index) }))
        .filter(({ key }) => !cache.songs.has(key));

    if (missing.length > 0) {
        const response = await api(
            `/plugin/playlists/me/${playlistRouteId(info)}/queue`,
            { songs: missing.map(({ item }) => queueItemPayload(item)) },
            undefined,
            true,
            false,
            'POST',
        ) as {
            playlist?: { name?: unknown } | null;
            songs?: PlaylistSong[];
        };

        if (typeof response.playlist?.name === 'string') {
            cache.playlistName = response.playlist.name;
        }

        (response.songs ?? []).forEach((song, index) => {
            const missingItem = missing[index];
            if (!missingItem) return;

            const queueSong = {
                item: missingItem.item,
                metadata: normalizeMetadata(song.metadata) ?? metadataFromQueueItem(missingItem.item),
            };
            cache.songs.set(missingItem.key, queueSong);
            if (queueSong.metadata) {
                songMetadataCache.set(songMetadataKey(missingItem.item), queueSong.metadata);
            }
        });
    }

    return {
        songs: queueItems.map((item, index): QueueSong => (
            cache.songs.get(queueItemCacheKey(item, index)) ?? {
                item,
                metadata: metadataFromQueueItem(item),
            }
        )),
        playlistName: cache.playlistName ?? info.name,
    };
}
