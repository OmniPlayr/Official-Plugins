import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import unknownArt from '../../assets/images/unknown-art.svg';
import { getCachedMetadata, metadataFromQueueItem } from './metadata';
import type { QueueSection, QueueSong, SongMetadata } from './types';

export default function Song({
    song,
    section,
    index,
    draggable = false,
    isDragging = false,
    dropPosition = null,
    onPlay,
    onDragStart,
    onDragOver,
    onDrop,
    onDragEnd,
} : {
    song: QueueSong;
    section: QueueSection;
    index: number;
    draggable?: boolean;
    isDragging?: boolean;
    dropPosition?: 'before' | 'after' | null;
    onPlay: (section: QueueSection, index: number, song: QueueSong) => void;
    onDragStart?: (section: QueueSection, index: number) => void;
    onDragOver?: (section: QueueSection, index: number, position: 'before' | 'after') => void;
    onDrop?: (section: QueueSection, index: number, position: 'before' | 'after') => void;
    onDragEnd?: () => void;
}) {
    const [ metadata, setMetadata ] = useState<SongMetadata | null>(song.metadata);

    useEffect(() => {
        const fallbackMetadata = metadataFromQueueItem(song.item);
        const initialMetadata = song.metadata ?? fallbackMetadata;
        setMetadata(initialMetadata);

        if (typeof initialMetadata?.album_art === 'string') {
            setMetadata(initialMetadata);
            return;
        }

        let cancelled = false;

        getCachedMetadata(song.item).then((metadata) => {
            if (cancelled) return;
            setMetadata(metadata ? { ...initialMetadata, ...metadata } : initialMetadata);
        }).catch(() => {
            if (cancelled) return;
            setMetadata(initialMetadata);
        });

        return () => {
            cancelled = true;
        };
    }, [song]);

    const albumArt = typeof metadata?.album_art === 'string' ? metadata.album_art : unknownArt;
    const title = metadata?.title ?? metadata?.filename ?? 'Unknown';
    const artist = metadata?.artist ?? 'Unknown';
    return (
        <div
            className={`queue-song-item${isDragging ? ' dragging' : ''}${dropPosition ? ` drop-${dropPosition}` : ''}`}
            draggable={draggable}
            onClick={() => onPlay(section, index, song)}
            onDragStart={(event) => {
                if (!draggable) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', `${section}:${index}`);
                onDragStart?.(section, index);
            }}
            onDragOver={(event) => {
                if (!draggable) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                onDragOver?.(section, index, position);
            }}
            onDrop={(event) => {
                if (!draggable) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
                onDrop?.(section, index, position);
            }}
            onDragEnd={onDragEnd}
        >
            <button
                className='queue-song-play'
                type='button'
                aria-label={`Play ${title}`}
                onClick={(event) => {
                    event.stopPropagation();
                    onPlay(section, index, song);
                }}
                draggable={false}
            >
                <Play className='queue-song-play-icon' />
            </button>
            <img
                src={albumArt}
                alt={title}
                className='queue-song-cover'
                draggable={false}
                onError={(event) => {
                    if (event.currentTarget.src !== unknownArt) {
                        event.currentTarget.src = unknownArt;
                    }
                }}
            />
            <div className='queue-song-info'>
                <div className='queue-song-title'>{title}</div>
                <div className='queue-song-artist'>{artist}</div>
            </div>
        </div>
    )
}
