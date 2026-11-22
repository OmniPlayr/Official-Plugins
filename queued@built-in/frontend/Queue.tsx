import { useEffect, useRef, useState } from 'react';
import { createPopup, on, player } from '@omniplayr/plugins';
import { LoaderCircle } from 'lucide-react';
import translations from './translations';
import Song from './Song';
import { QUEUE_PAGE_SIZE, QUEUE_POPUP_ID } from './constants';
import { currentQueueSong, metadataFromQueueItem } from './metadata';
import { parsePlaylistQueue } from './playlistQueue';
import { moveItemToDropTarget, replaceNextQueuePreservingOrder, replacePriorityQueue } from './playerQueue';
import { queueSignature } from './queueSignature';
import type { DragState, DropTarget, QueueSection, QueueSong } from './types';
import './styles/Queue.css';

export default function Queue({ popup = false }: { popup?: boolean }) {
    const { t } = translations.useTranslation();
    const [currentSong, setCurrentSong] = useState<QueueSong | null>(null);
    const [priorityQueueItems, setPriorityQueueItems] = useState<QueueSong[]>([]);
    const [nextQueueItems, setNextQueueItems] = useState<QueueSong[]>([]);
    const [nextQueueName, setNextQueueName] = useState<string | null>(null);
    const [visibleLimit, setVisibleLimit] = useState(QUEUE_PAGE_SIZE);
    const [totalPriorityItems, setTotalPriorityItems] = useState(0);
    const [totalNextItems, setTotalNextItems] = useState(0);
    const [loadingMore, setLoadingMore] = useState(false);

    const queueSignatureRef = useRef<string | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragStateRef = useRef<DragState>(null);
    const [dragging, setDragging] = useState<DragState>(null);
    const [dropTarget, setDropTarget] = useState<DropTarget>(null);

    useEffect(() => {
        queueSignatureRef.current = null;

        const updateQueue = () => {
            const currentSong = currentQueueSong();
            const priorityItems = player.getPriorityQueue;
            const nextItems = player.getNextQueue;
            const queueItems = [
                ...(currentSong ? [currentSong.item] : []),
                ...priorityItems,
                ...nextItems,
            ];

            const loadedMetadata = queueItems.filter((item) => item.metadata).length;
            const signature = `${queueSignature(player.queueName, queueItems, visibleLimit)}:${loadedMetadata}`;

            if (queueSignatureRef.current === signature) return;
            queueSignatureRef.current = signature;

            const playlistInfo = parsePlaylistQueue(player.queueName, nextItems);

            setCurrentSong(currentSong);
            setPriorityQueueItems(priorityItems.slice(0, visibleLimit).map((item): QueueSong => ({
                item,
                metadata: metadataFromQueueItem(item),
            })));
            setNextQueueItems(nextItems.slice(0, visibleLimit).map((item): QueueSong => ({
                item,
                metadata: metadataFromQueueItem(item),
            })));
            setNextQueueName(playlistInfo?.name ?? null);
            setTotalPriorityItems(priorityItems.length);
            setTotalNextItems(nextItems.length);
            setLoadingMore(false);
        };

        updateQueue();

        return player.subscribe(updateQueue);
    }, [visibleLimit]);

    const hasMore = totalPriorityItems > priorityQueueItems.length || totalNextItems > nextQueueItems.length;

    const loadMore = () => {
        if (!hasMore || loadingMore) return;
        setLoadingMore(true);
        setVisibleLimit((current) => current + QUEUE_PAGE_SIZE);
    };

    const loadMoreIfNeeded = () => {
        const container = containerRef.current;
        if (!container) return;

        const remaining = container.scrollHeight - container.scrollTop - container.clientHeight;
        if (remaining > 80) return;

        loadMore();
    };

    const title = nextQueueName
        ? t('queue.next-from', { playlist: nextQueueName })
        : t('queue.next-up');

    const playQueueSong = (section: QueueSection, index: number, song: QueueSong) => {
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
    };

    const reorderQueue = (targetSection: QueueSection, targetIndex: number, position: 'before' | 'after') => {
        const source = dragStateRef.current;
        dragStateRef.current = null;
        setDragging(null);
        setDropTarget(null);

        if (!source || source.section !== targetSection) return;

        if (targetSection === 'priority') {
            const reordered = moveItemToDropTarget(player.getPriorityQueue, source.index, targetIndex, position);
            replacePriorityQueue(reordered);
            setPriorityQueueItems(reordered.slice(0, visibleLimit).map((item): QueueSong => ({
                item,
                metadata: metadataFromQueueItem(item),
            })));
            return;
        }

        if (targetSection === 'next') {
            const reordered = moveItemToDropTarget(player.getNextQueue, source.index, targetIndex, position);
            replaceNextQueuePreservingOrder(reordered);
            setNextQueueItems(reordered.slice(0, visibleLimit).map((item): QueueSong => ({
                item,
                metadata: metadataFromQueueItem(item),
            })));
        }
    };

    const startDrag = (section: QueueSection, index: number) => {
        if (section === 'current') return;

        const next = { section, index };
        dragStateRef.current = next;
        setDragging(next);
        setDropTarget(null);
    };

    const updateDropTarget = (section: QueueSection, index: number, position: 'before' | 'after') => {
        const source = dragStateRef.current;

        if (!source || source.section !== section) {
            setDropTarget(null);
            return;
        }

        setDropTarget({ section, index, position });
    };

    const endDrag = () => {
        dragStateRef.current = null;
        setDragging(null);
        setDropTarget(null);
    };

    return (
        <div
            className={`queue-view-container${popup ? ' queue-view-container-popup' : ''}`}
            ref={containerRef}
            onScroll={loadMoreIfNeeded}
        >
            {currentSong && (
                <div className='queue-view'>
                    <p className='queue-view-title'>{t('queue.now-playing')}</p>
                    <div className='queue-songs queue-now-playing'>
                        <Song
                            song={currentSong}
                            section='current'
                            index={0}
                            onPlay={playQueueSong}
                        />
                    </div>
                </div>
            )}

            {priorityQueueItems.length > 0 && (
                <div className='queue-view'>
                    <p className='queue-view-title'>{t('queue.queue')}</p>
                    <div className='queue-songs'>
                        {priorityQueueItems.map((item, index) => (
                            <Song
                                key={`${item.item.sourceType}:${item.item.songId}:${index}`}
                                song={item}
                                section='priority'
                                index={index}
                                draggable
                                isDragging={dragging?.section === 'priority' && dragging.index === index}
                                dropPosition={dropTarget?.section === 'priority' && dropTarget.index === index ? dropTarget.position : null}
                                onPlay={playQueueSong}
                                onDragStart={startDrag}
                                onDragOver={updateDropTarget}
                                onDrop={reorderQueue}
                                onDragEnd={endDrag}
                            />
                        ))}
                    </div>
                </div>
            )}

            <div className='queue-view'>
                <p className='queue-view-title'>{title}</p>
                <div className='queue-songs'>
                    {nextQueueItems.map((item, index) => (
                        <Song
                            key={`${item.item.sourceType}:${item.item.songId}:${index}`}
                            song={item}
                            section='next'
                            index={index}
                            draggable
                            isDragging={dragging?.section === 'next' && dragging.index === index}
                            dropPosition={dropTarget?.section === 'next' && dropTarget.index === index ? dropTarget.position : null}
                            onPlay={playQueueSong}
                            onDragStart={startDrag}
                            onDragOver={updateDropTarget}
                            onDrop={reorderQueue}
                            onDragEnd={endDrag}
                        />
                    ))}
                </div>
            </div>

            {loadingMore && (
                <div className='queue-load-more-status'>
                    <LoaderCircle className='queue-load-more-spinner' />
                    <span>{t('queue.loading')}</span>
                </div>
            )}

            {hasMore && !loadingMore && (
                <button className='queue-load-more-button' type='button' onClick={loadMore}>
                    {t('queue.load-more')}
                </button>
            )}
        </div>
    );
}

export function openQueuePopup() {
    createPopup({
        id: QUEUE_POPUP_ID,
        title: 'Queue',
        close_button: true,
        content: <Queue popup={true} />,
    });
}

on('queue.mobile:open', openQueuePopup);