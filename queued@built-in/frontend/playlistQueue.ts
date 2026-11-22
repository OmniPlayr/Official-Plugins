import { player, type QueueItem } from '@omniplayr/plugins';
import type { PlaylistQueueInfo } from './types';

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