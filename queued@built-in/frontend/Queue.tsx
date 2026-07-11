import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPopup, hasFrontendPlugin, on, player, useIsMobile } from '@omniplayr/plugins';
import { LoaderCircle } from 'lucide-react';
import translations from '.';
import Song from './Song';
import { QUEUE_MIN_WIDTH, QUEUE_PAGE_SIZE, QUEUE_POPUP_ID } from './constants';
import { currentQueueSong, metadataFromQueueItem } from './metadata';
import { getPlaylistQueueSongs, parsePlaylistQueue } from './playlistQueue';
import { moveItemToDropTarget, replaceNextQueuePreservingOrder, replacePriorityQueue } from './playerQueue';
import { queueSignature } from './queueSignature';
import { getQueueVisibleState, readStoredQueueWidth, setSideTabWidth, subscribeQueueVisibleState, subscribeSideTabWidth } from './queueState';
import type { DragState, DropTarget, QueueSection, QueueSong } from './types';
import './styles/Queue.css';

export default function Queue({ popup = false }: { popup?: boolean }) {
    const { t } = translations.useTranslation();
    const isMobile = useIsMobile();
    const [ queueVisible, setQueueVisible ] = useState(getQueueVisibleState);
    const [ currentSong, setCurrentSong ] = useState<QueueSong | null>(null);
    const [ priorityQueueItems, setPriorityQueueItems ] = useState<QueueSong[]>([]);
    const [ nextQueueItems, setNextQueueItems ] = useState<QueueSong[]>([]);
    const [ nextQueueName, setNextQueueName ] = useState<string | null>(null);
    const [ visibleLimit, setVisibleLimit ] = useState(QUEUE_PAGE_SIZE);
    const [ totalPriorityItems, setTotalPriorityItems ] = useState(0);
    const [ totalNextItems, setTotalNextItems ] = useState(0);
    const [ loadingMore, setLoadingMore ] = useState(false);
    const [ queueWidth, setQueueWidth ] = useState(readStoredQueueWidth);
    const queueSignatureRef = useRef<string | null>(null);
    const requestIdRef = useRef(0);
    const containerRef = useRef<HTMLDivElement>(null);
    const resizingRef = useRef<{
        startX: number;
        startWidth: number;
        maxWidth: number;
    } | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const pendingResizeWidthRef = useRef(queueWidth);
    const dragStateRef = useRef<DragState>(null);
    const [ dragging, setDragging ] = useState<DragState>(null);
    const [ dropTarget, setDropTarget ] = useState<DropTarget>(null);

    useEffect(() => subscribeQueueVisibleState(setQueueVisible), []);
    useEffect(() => subscribeSideTabWidth(setQueueWidth), []);

    useEffect(() => {
        if (popup) return;

        const clampWidth = () => {
            const dashboard = containerRef.current?.closest('.dashboard-hor') as HTMLElement | null;
            const maxWidth = dashboard ? Math.max(QUEUE_MIN_WIDTH, Math.floor(dashboard.clientWidth / 2)) : Number.POSITIVE_INFINITY;
            const next = Math.min(Math.max(QUEUE_MIN_WIDTH, readStoredQueueWidth()), maxWidth);
            setQueueWidth(setSideTabWidth(next));
        };

        clampWidth();
        window.addEventListener('resize', clampWidth);
        return () => window.removeEventListener('resize', clampWidth);
    }, [popup]);

    useEffect(() => {
        pendingResizeWidthRef.current = queueWidth;
    }, [queueWidth]);

    useEffect(() => () => {
        if (resizeFrameRef.current !== null) {
            window.cancelAnimationFrame(resizeFrameRef.current);
        }
    }, []);

    useEffect(() => {
        let cancelled = false;

        const updateQueue = () => {
            const currentSong = currentQueueSong();
            const priorityItems = player.getPriorityQueue;
            const nextItems = player.getNextQueue;
            const queueItems = [
                ...(currentSong ? [currentSong.item] : []),
                ...priorityItems,
                ...nextItems,
            ];
            const signature = queueSignature(player.queueName, queueItems, visibleLimit);
            if (queueSignatureRef.current === signature) return;
            queueSignatureRef.current = signature;

            const id = requestIdRef.current + 1;
            requestIdRef.current = id;

            const playlistInfo = parsePlaylistQueue(player.queueName, nextItems);
            const visiblePriorityItems = priorityItems.slice(0, visibleLimit);
            const visibleNextItems = nextItems.slice(0, visibleLimit);
            const fallbackPrioritySongs = visiblePriorityItems.map((item): QueueSong => ({
                item,
                metadata: metadataFromQueueItem(item),
            }));
            const fallbackNextSongs = visibleNextItems.map((item): QueueSong => ({
                item,
                metadata: metadataFromQueueItem(item),
            }));

            setCurrentSong(currentSong);
            setPriorityQueueItems(fallbackPrioritySongs);
            setNextQueueItems(fallbackNextSongs);
            setNextQueueName(playlistInfo?.name ?? null);
            setTotalPriorityItems(priorityItems.length);
            setTotalNextItems(nextItems.length);

            if (!playlistInfo || !hasFrontendPlugin('playlists@built-in')) {
                setLoadingMore(false);
                return;
            }

            getPlaylistQueueSongs(playlistInfo, visibleNextItems)
                .then(({ songs, playlistName }) => {
                    if (cancelled || requestIdRef.current !== id) return;
                    setCurrentSong(currentSong);
                    setPriorityQueueItems(fallbackPrioritySongs);
                    setNextQueueItems(songs);
                    setNextQueueName(playlistName);
                    setTotalPriorityItems(priorityItems.length);
                    setTotalNextItems(nextItems.length);
                    setLoadingMore(false);
                })
                .catch(() => {
                    if (cancelled || requestIdRef.current !== id) return;
                    setCurrentSong(currentSong);
                    setPriorityQueueItems(fallbackPrioritySongs);
                    setNextQueueItems(fallbackNextSongs);
                    setNextQueueName(playlistInfo.name);
                    setTotalPriorityItems(priorityItems.length);
                    setTotalNextItems(nextItems.length);
                    setLoadingMore(false);
                });
        };

        updateQueue();

        const unsubscribe = player.subscribe(updateQueue);

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [visibleLimit]);

    if (!popup && isMobile) return null;

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

    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (popup) return;
        const container = containerRef.current;
        const dashboard = container?.closest('.dashboard-hor') as HTMLElement | null;
        if (!container || !dashboard) return;

        resizingRef.current = {
            startX: event.clientX,
            startWidth: container.getBoundingClientRect().width,
            maxWidth: Math.max(QUEUE_MIN_WIDTH, Math.floor(dashboard.clientWidth / 2)),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add('queue-view-resizing');
    };

    const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const resizing = resizingRef.current;
        if (!resizing) return;

        const delta = resizing.startX - event.clientX;
        pendingResizeWidthRef.current = Math.min(
            Math.max(QUEUE_MIN_WIDTH, resizing.startWidth + delta),
            resizing.maxWidth,
        );

        if (resizeFrameRef.current !== null) return;
        resizeFrameRef.current = window.requestAnimationFrame(() => {
            resizeFrameRef.current = null;
            const container = containerRef.current;
            if (!container || !resizingRef.current) return;
            container.style.width = `${pendingResizeWidthRef.current}px`;
            setQueueWidth(setSideTabWidth(pendingResizeWidthRef.current));
        });
    };

    const endResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!resizingRef.current) return;
        resizingRef.current = null;
        if (resizeFrameRef.current !== null) {
            window.cancelAnimationFrame(resizeFrameRef.current);
            resizeFrameRef.current = null;
        }
        const finalWidth = Math.round(pendingResizeWidthRef.current);
        if (containerRef.current) {
            containerRef.current.style.width = `${finalWidth}px`;
        }
        setQueueWidth(setSideTabWidth(finalWidth));
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.classList.remove('queue-view-resizing');
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
            remaining.forEach((item) => player.addToQueue(item.songId, item.sourceType, item.extra));
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
            className={`queue-view-container${popup ? ' queue-view-container-popup' : ''}${!popup && !queueVisible ? ' queue-view-container-hidden' : ''}`}
            ref={containerRef}
            onScroll={loadMoreIfNeeded}
            style={popup ? undefined : { width: queueVisible ? queueWidth : 0 }}
            aria-hidden={!popup && !queueVisible}
        >
            {!popup && queueVisible && (
                <div
                    className='queue-view-resize-handle'
                    onPointerDown={startResize}
                    onPointerMove={resize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    role='separator'
                    aria-orientation='vertical'
                />
            )}
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
    )
}

export {
    getQueueVisibleState,
    readStoredQueueWidth,
    setQueueVisibleState,
    setSideTabWidth,
    subscribeQueueVisibleState,
    subscribeSideTabWidth,
    toggleQueueVisibleState,
} from './queueState';

export function openQueuePopup() {
    createPopup({
        id: QUEUE_POPUP_ID,
        title: 'Queue',
        close_button: true,
        content: <Queue popup={true} />,
    });
}

on('queue.mobile:open', openQueuePopup);
