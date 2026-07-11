import { player, type QueueItem } from '@omniplayr/plugins';

export function moveItem<T>(items: T[], fromIndex: number, toIndex: number) {
    const next = [...items];
    const [item] = next.splice(fromIndex, 1);
    if (item === undefined) return items;
    next.splice(toIndex, 0, item);
    return next;
}

export function moveItemToDropTarget<T>(items: T[], fromIndex: number, targetIndex: number, position: 'before' | 'after') {
    let insertionIndex = targetIndex + (position === 'after' ? 1 : 0);
    if (fromIndex < insertionIndex) insertionIndex -= 1;
    insertionIndex = Math.max(0, Math.min(items.length - 1, insertionIndex));
    return moveItem(items, fromIndex, insertionIndex);
}

function notifyPlayerQueueChanged() {
    const internalPlayer = player as unknown as {
        notify?: () => void;
        schedulePrefetch?: () => void;
    };
    internalPlayer.schedulePrefetch?.();
    internalPlayer.notify?.();
}

export function replacePriorityQueue(items: QueueItem[]) {
    const internalPlayer = player as unknown as {
        priorityQueue?: QueueItem[];
    };

    if (Array.isArray(internalPlayer.priorityQueue)) {
        internalPlayer.priorityQueue = [...items];
        notifyPlayerQueueChanged();
        return;
    }

    player.clearPriorityQueue();
    items.forEach((item) => player.addToQueue(item.songId, item.sourceType, item.extra));
}

export function replaceNextQueuePreservingOrder(items: QueueItem[]) {
    const internalPlayer = player as unknown as {
        nextQueueItems?: QueueItem[];
        nextQueueOriginal?: QueueItem[];
        currentSongFromNextQueue?: boolean;
    };

    if (Array.isArray(internalPlayer.nextQueueItems) && Array.isArray(internalPlayer.nextQueueOriginal)) {
        const current = internalPlayer.currentSongFromNextQueue && player.currentSongId && player.currentSourceType
            ? [{
                songId: player.currentSongId,
                sourceType: player.currentSourceType,
                extra: player.currentExtra ?? undefined,
            }]
            : [];

        internalPlayer.nextQueueItems = [...items];
        internalPlayer.nextQueueOriginal = [...current, ...items];
        notifyPlayerQueueChanged();
        return;
    }

    const wasShuffling = player.shuffle;
    if (wasShuffling) player.toggleShuffle();
    player.setNextQueue(player.queueName, items);
    if (wasShuffling) player.toggleShuffle();
}
