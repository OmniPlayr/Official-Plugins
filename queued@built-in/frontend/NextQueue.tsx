import { useEffect, useState } from 'react';
import './styles/NextQueue.css';
import translations from './translations';
import { player, toggleInfoBar } from '@omniplayr/plugins';
import Song from './Song';
import { metadataFromQueueItem } from './metadata';
import { replaceNextQueuePreservingOrder } from './playerQueue';
import type { QueueSection, QueueSong } from './types';

type NextSong = {
    song: QueueSong;
    section: QueueSection;
};

function playQueueSong(section: QueueSection, index: number, song: QueueSong) {
    if (section === 'current') {
        player.togglePlay();
        return;
    }

    if (section === 'priority') {
        const priorityItems = player.getPriorityQueue;
        const selected = priorityItems[index] ?? song.item;
        const remaining = priorityItems.slice(index + 1);

        player.clearPriorityQueue();
        remaining.forEach((item) => player.addToQueue(item.songId, item.sourceType, item.extra, item.metadata));
        void player.playSong(selected.songId, selected.sourceType, selected.extra, false);
        return;
    }

    const nextItems = player.getNextQueue;
    const selected = nextItems[index] ?? song.item;
    const remaining = nextItems.slice(index + 1);
    replaceNextQueuePreservingOrder(remaining);
    void player.playSong(selected.songId, selected.sourceType, selected.extra, true);
}

function NextQueue() {
    const { t } = translations.useTranslation();
    const [nextSong, setNextSong] = useState<NextSong | null>(null);

    useEffect(() => {
        const updateQueue = () => {
            const priorityItem = player.getPriorityQueue[0];
            const nextItem = player.getNextQueue[0];
            const item = priorityItem ?? nextItem;

            if (!item) {
                setNextSong(null);
                return;
            }

            setNextSong({
                song: { item, metadata: metadataFromQueueItem(item) },
                section: priorityItem ? 'priority' : 'next',
            });
        };

        updateQueue();

        return player.subscribe(updateQueue);
    }, []);

    if (!nextSong) return null;

    return (
        <div className="next-queue">
            <div className="next-queue-header">
                <p className="next-queue-text">{t('next-queue.text')}</p>
                <button 
                    className="next-queue-open"
                    onClick={() => toggleInfoBar('queued@built-in', 'queued')}
                >{t('next-queue.open')}</button>
            </div>
            <Song
                song={nextSong.song}
                section={nextSong.section}
                index={0}
                onPlay={playQueueSong}
            />
        </div>
    );
}

export default NextQueue;