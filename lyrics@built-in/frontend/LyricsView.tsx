import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import './styles/LyricsView.css';
import { getLyricsVisibleState, readStoredSideTabWidth, setSideTabWidth, subscribeLyricsVisibleState, subscribeSideTabWidth } from './lyricsState';
import { player } from '@omniplayr/plugins';
import getLyrics from './lyrics';
import { AudioLines, LoaderCircle, Music } from 'lucide-react';
import translations from './translations';
import { currentQueueSong } from './metadata';
import { useSideTabTransition } from './useSideTabTransition';

const SIDETAB_MIN_WIDTH = 300;
const FOLLOW_CENTER_THRESHOLD_PX = 140;

type LyricsData = Awaited<ReturnType<typeof getLyrics>>;
type LyricsLoadState =
    | { status: 'idle' | 'loading'; lyrics: null }
    | { status: 'loaded'; lyrics: LyricsData };

const lyricsCache = new Map<string, LyricsData>();
const NOT_FOUND_MESSAGE_COUNT = 4;

interface LyricsResult {
    syncedLyrics: string | null;
    plainLyrics: string | null;
    lyricsVisible: boolean;
    syncRequest: number;
    onFollowingChange: (following: boolean) => void;
}

interface SyncedLyricLine {
    time: number;
    text: string;
}

interface AverageColor {
    color: string;
    textA0: string;
    textA20: string;
    textA30: string;
    textA40: string;
}

const SYNCED_LYRIC_LINE_REGEX = /^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/;

function mixColor(
    red: number,
    green: number,
    blue: number,
    targetRed: number,
    targetGreen: number,
    targetBlue: number,
    amount: number,
) {
    return `rgb(${
        Math.round(red + (targetRed - red) * amount)
    }, ${
        Math.round(green + (targetGreen - green) * amount)
    }, ${
        Math.round(blue + (targetBlue - blue) * amount)
    })`;
}

function createTextPalette(red: number, green: number, blue: number) {
    const backgroundLuminance = relativeLuminance(red, green, blue);
    const whiteContrast = contrastRatio(backgroundLuminance, 1);
    const darkLuminance = relativeLuminance(24, 24, 24);
    const darkContrast = contrastRatio(backgroundLuminance, darkLuminance);
    const useLightText = whiteContrast >= darkContrast;

    const target = useLightText
        ? { red: 255, green: 255, blue: 255 }
        : { red: 24, green: 24, blue: 24 };

    return {
        textA0: mixColor(
            red,
            green,
            blue,
            target.red,
            target.green,
            target.blue,
            0.96,
        ),
        textA20: mixColor(
            red,
            green,
            blue,
            target.red,
            target.green,
            target.blue,
            0.82,
        ),
        textA30: mixColor(
            red,
            green,
            blue,
            target.red,
            target.green,
            target.blue,
            0.7,
        ),
        textA40: mixColor(
            red,
            green,
            blue,
            target.red,
            target.green,
            target.blue,
            0.58,
        ),
    };
}

function linearizeColorChannel(channel: number) {
    const value = channel / 255;
    return value <= 0.04045
        ? value / 12.92
        : Math.pow((value + 0.055) / 1.055, 2.4);
}

function relativeLuminance(red: number, green: number, blue: number) {
    return (
        0.2126 * linearizeColorChannel(red)
        + 0.7152 * linearizeColorChannel(green)
        + 0.0722 * linearizeColorChannel(blue)
    );
}

function contrastRatio(first: number, second: number) {
    const lighter = Math.max(first, second);
    const darker = Math.min(first, second);

    return (lighter + 0.05) / (darker + 0.05);
}

function extractAverageColor(source: string): Promise<AverageColor | null> {
    return new Promise(resolve => {
        const image = new Image();
        image.crossOrigin = 'anonymous';

        image.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                const size = 32;
                canvas.width = size;
                canvas.height = size;

                const context = canvas.getContext('2d', {
                    willReadFrequently: true,
                });

                if (!context) {
                    resolve(null);
                    return;
                }

                context.drawImage(image, 0, 0, size, size);

                const pixels = context.getImageData(0, 0, size, size).data;
                let red = 0;
                let green = 0;
                let blue = 0;
                let count = 0;

                for (let index = 0; index < pixels.length; index += 4) {
                    const alpha = pixels[index + 3];

                    if (alpha < 32) continue;

                    red += pixels[index];
                    green += pixels[index + 1];
                    blue += pixels[index + 2];
                    count++;
                }

                if (!count) {
                    resolve(null);
                    return;
                }

                const averageRed = Math.round(red / count);
                const averageGreen = Math.round(green / count);
                const averageBlue = Math.round(blue / count);

                const palette = createTextPalette(
                    averageRed,
                    averageGreen,
                    averageBlue,
                );

                resolve({
                    color: `rgb(${averageRed}, ${averageGreen}, ${averageBlue})`,
                    ...palette,
                });
            } catch {
                resolve(null);
            }
        };

        image.onerror = () => resolve(null);
        image.src = source;
    });
}

function parseSyncedLyrics(syncedLyrics: string) {
    return syncedLyrics
        .split(/\r?\n/)
        .map((line): SyncedLyricLine | null => {
            const match = line.match(SYNCED_LYRIC_LINE_REGEX);
            if (!match) return null;

            const minutes = Number(match[1]);
            const seconds = Number(match[2]);
            if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;

            return {
                time: minutes * 60 + seconds,
                text: match[3],
            };
        })
        .filter((line): line is SyncedLyricLine => line !== null);
}

function parsePlainLyrics(plainLyrics: string) {
    return plainLyrics
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function isCurrentSyncedLine(lines: SyncedLyricLine[], index: number, currentTime: number) {
    const line = lines[index];
    const nextLine = lines[index + 1];
    return currentTime >= line.time && (!nextLine || currentTime < nextLine.time);
}

function syncedLineClassName(lines: SyncedLyricLine[], index: number, currentTime: number) {
    const line = lines[index];
    const classNames = ['lyrics-line', 'synced'];

    if (isCurrentSyncedLine(lines, index, currentTime)) {
        classNames.push('current');
    } else if (currentTime < line.time) {
        classNames.push('to-go');
    }

    return classNames.join(' ');
}

function currentSyncedLineIndex(lines: SyncedLyricLine[], currentTime: number) {
    return lines.findIndex((_, index) => isCurrentSyncedLine(lines, index, currentTime));
}

function scrollTargetLineIndex(lines: SyncedLyricLine[], currentTime: number) {
    const currentIndex = currentSyncedLineIndex(lines, currentTime);
    if (currentIndex !== -1) return currentIndex;

    const nextIndex = lines.findIndex(line => currentTime < line.time);
    return nextIndex === -1 ? lines.length - 1 : nextIndex;
}

function scrollLineToCenter(container: HTMLElement, line: HTMLElement, behavior: ScrollBehavior) {
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const nextScrollTop = container.scrollTop
        + lineRect.top
        - containerRect.top
        - (container.clientHeight / 2)
        + (lineRect.height / 2);

    container.scrollTo({
        top: Math.max(0, nextScrollTop),
        behavior,
    });
}

function isLineNearCenter(container: HTMLElement, line: HTMLElement) {
    const containerRect = container.getBoundingClientRect();
    const lineRect = line.getBoundingClientRect();
    const containerCenter = containerRect.top + (containerRect.height / 2);
    const lineCenter = lineRect.top + (lineRect.height / 2);
    return Math.abs(containerCenter - lineCenter) <= FOLLOW_CENTER_THRESHOLD_PX;
}

function currentTrackKey() {
    return player.currentSongId && player.currentSourceType
        ? `${player.currentSourceType}:${player.currentSongId}`
        : null;
}

function cacheableLyrics(lyrics: LyricsData): LyricsData {
    return lyrics?.syncedLyrics || lyrics?.plainLyrics ? lyrics : null;
}

function hashString(value: string) {
    let hash = 0;

    for (let index = 0; index < value.length; index++) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }

    return Math.abs(hash);
}

function Lyrics({
    syncedLyrics,
    plainLyrics,
    lyricsVisible,
    syncRequest,
    onFollowingChange,
}: LyricsResult) {
    const { t } = translations.useTranslation();
    const [ currentTime, setCurrentTime ] = useState(player.currentTime);
    const rootRef = useRef<HTMLDivElement>(null);
    const lineRefs = useRef<Array<HTMLParagraphElement | null>>([]);
    const followCurrentLineRef = useRef(true);
    const programmaticScrollTimeoutRef = useRef<number | null>(null);
    const syncedLines = useMemo(
        () => syncedLyrics ? parseSyncedLyrics(syncedLyrics) : [],
        [syncedLyrics],
    );
    const plainLines = useMemo(
        () => !syncedLines.length && plainLyrics ? parsePlainLyrics(plainLyrics) : [],
        [syncedLines.length, plainLyrics],
    );
    const targetLineIndex = useMemo(
        () => syncedLines.length ? scrollTargetLineIndex(syncedLines, currentTime) : -1,
        [syncedLines, currentTime],
    );

    const scrollToTargetLine = (behavior: ScrollBehavior) => {
        if (targetLineIndex === -1) return;

        const container = rootRef.current;
        const line = lineRefs.current[targetLineIndex];
        if (!container || !line) return;

        if (programmaticScrollTimeoutRef.current !== null) {
            window.clearTimeout(programmaticScrollTimeoutRef.current);
        }

        scrollLineToCenter(container, line, behavior);
        programmaticScrollTimeoutRef.current = window.setTimeout(() => {
            programmaticScrollTimeoutRef.current = null;
        }, 450);
    };

    useEffect(() => {
        if (!syncRequest) return;

        followCurrentLineRef.current = true;
        onFollowingChange(true);
        scrollToTargetLine('smooth');
    }, [syncRequest]);

    useEffect(() => {
        const updateCurrentTime = () => {
            setCurrentTime(player.currentTime);
        };

        updateCurrentTime();

        return player.subscribe(updateCurrentTime);
    }, []);

    useEffect(() => () => {
        if (programmaticScrollTimeoutRef.current !== null) {
            window.clearTimeout(programmaticScrollTimeoutRef.current);
        }
    }, []);

    useEffect(() => {
        lineRefs.current = lineRefs.current.slice(0, syncedLines.length);
        followCurrentLineRef.current = true;
        onFollowingChange(true);
    }, [syncedLines]);

    useEffect(() => {
        if (!lyricsVisible) return;
        scrollToTargetLine('auto');
    }, [lyricsVisible, syncedLines]);

    useEffect(() => {
        if (!lyricsVisible || !followCurrentLineRef.current) return;
        scrollToTargetLine('smooth');
    }, [lyricsVisible, targetLineIndex]);

    const handleScroll = () => {
        if (programmaticScrollTimeoutRef.current !== null || targetLineIndex === -1) return;

        const container = rootRef.current;
        const line = lineRefs.current[targetLineIndex];
        if (!container || !line) return;

        const shouldFollow = isLineNearCenter(container, line);
        followCurrentLineRef.current = shouldFollow;
        onFollowingChange(shouldFollow);
    };

    const seekToLine = (time: number) => {
        if (player.duration <= 0) return;

        followCurrentLineRef.current = true;
        onFollowingChange(true);
        player.seek(Math.min(Math.max(time / player.duration, 0), 1));
    };

    const handleLineKeyDown = (event: ReactKeyboardEvent<HTMLParagraphElement>, time: number) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;

        event.preventDefault();
        seekToLine(time);
    };

    useEffect(() => {
        const container = rootRef.current;
        if (!container) return;

        container.addEventListener('scroll', handleScroll, { passive: true });
        return () => container.removeEventListener('scroll', handleScroll);
    }, [targetLineIndex]);

    if (!syncedLines.length && !plainLines.length) return null;

    return (
        <div className="lyrics" ref={rootRef}>
            {syncedLines.length > 0 && syncedLines.map((line, index) => (
                <p
                    key={`${line.time}-${index}`}
                    ref={element => {
                        lineRefs.current[index] = element;
                    }}
                    className={syncedLineClassName(syncedLines, index, currentTime)}
                    onClick={() => seekToLine(line.time)}
                    onKeyDown={event => handleLineKeyDown(event, line.time)}
                    role='button'
                    tabIndex={0}
                >
                    {line.text || <Music className='lyrics-line-empty-icon' aria-label={t('lyrics.instrumental')} />}
                </p>
            ))}
            {!syncedLines.length && plainLines.map((line, index) => (
                <p key={index} className='lyrics-line current'>
                    {line}
                </p>
            ))}
        </div>
    );
}

function LyricsView() {
    const { t } = translations.useTranslation();
    const [ lyricsVisible, setLyricsVisible ] = useState(getLyricsVisibleState);
    const lyricsTransition = useSideTabTransition('lyrics', lyricsVisible);
    const [ sideTabWidth, setSideTabWidthState ] = useState(readStoredSideTabWidth);
    const [ lyricsState, setLyricsState ] = useState<LyricsLoadState>({ status: 'idle', lyrics: null });
    const containerRef = useRef<HTMLDivElement>(null);
    const resizingRef = useRef<{
        startX: number;
        startWidth: number;
        maxWidth: number;
    } | null>(null);
    const resizeFrameRef = useRef<number | null>(null);
    const pendingResizeWidthRef = useRef(sideTabWidth);
    const [ averageColor, setAverageColor ] = useState<AverageColor | null>(null);
    const [ isFollowingLyrics, setIsFollowingLyrics ] = useState(true);
    const [ syncRequest, setSyncRequest ] = useState(0);

    useEffect(() => subscribeLyricsVisibleState(setLyricsVisible), []);
    useEffect(() => subscribeSideTabWidth(setSideTabWidthState), []);

    useEffect(() => {
        const clampWidth = () => {
            const dashboard = containerRef.current?.closest('.dashboard-hor') as HTMLElement | null;
            const maxWidth = dashboard ? Math.max(SIDETAB_MIN_WIDTH, Math.floor(dashboard.clientWidth / 2)) : Number.POSITIVE_INFINITY;
            const next = Math.min(Math.max(SIDETAB_MIN_WIDTH, readStoredSideTabWidth()), maxWidth);
            setSideTabWidthState(setSideTabWidth(next));
        };

        clampWidth();
        window.addEventListener('resize', clampWidth);
        return () => window.removeEventListener('resize', clampWidth);
    }, []);

    useEffect(() => {
        pendingResizeWidthRef.current = sideTabWidth;
    }, [sideTabWidth]);

    useEffect(() => () => {
        if (resizeFrameRef.current !== null) {
            window.cancelAnimationFrame(resizeFrameRef.current);
        }
    }, []);

    useEffect(() => {
        let disposed = false;
        let displayedTrackKey: string | null = null;
        let loadingTrackKey: string | null = null;
        let requestId = 0;

        const loadCurrentLyrics = async () => {
            if (disposed) return;

            const trackKey = currentTrackKey();

            if (!trackKey) {
                displayedTrackKey = null;
                loadingTrackKey = null;
                requestId++;
                setLyricsState({ status: 'idle', lyrics: null });
                return;
            }

            if (displayedTrackKey === trackKey || loadingTrackKey === trackKey) {
                return;
            }

            if (lyricsCache.has(trackKey)) {
                displayedTrackKey = trackKey;
                loadingTrackKey = null;
                setLyricsState({ status: 'loaded', lyrics: lyricsCache.get(trackKey) ?? null });
                return;
            }

            displayedTrackKey = null;
            loadingTrackKey = trackKey;
            setLyricsState({ status: 'loading', lyrics: null });

            const currentRequestId = ++requestId;
            let result: LyricsData = null;

            try {
                result = cacheableLyrics(await getLyrics());
            } catch (error) {
                console.warn('[lyrics@built-in] Failed to load lyrics.', error);
            }

            lyricsCache.set(trackKey, result);

            if (
                !disposed &&
                currentRequestId === requestId &&
                currentTrackKey() === trackKey
            ) {
                displayedTrackKey = trackKey;
                loadingTrackKey = null;
                setLyricsState({ status: 'loaded', lyrics: result });
            } else if (loadingTrackKey === trackKey) {
                loadingTrackKey = null;
            }
        };

        const checkCurrentTrack = () => {
            void loadCurrentLyrics();
        };

        checkCurrentTrack();

        const unsubscribePlayer = player.subscribe(checkCurrentTrack);
        const unsubscribeTrackChange = player.subscribeToTrackChange(checkCurrentTrack);

        return () => {
            disposed = true;
            requestId++;
            unsubscribePlayer();
            unsubscribeTrackChange();
        };
    }, []);

    useEffect(() => {
        let disposed = false;
        let loadedAlbumArt: string | null = null;
        let requestId = 0;

        const updateAverageColor = async () => {
            const song = await currentQueueSong();
            const albumArt = typeof song?.metadata?.album_art === 'string'
                ? song.metadata.album_art
                : null;

            if (disposed || albumArt === loadedAlbumArt) return;

            loadedAlbumArt = albumArt;
            const currentRequestId = ++requestId;

            if (!albumArt) {
                setAverageColor(null);
                return;
            }

            const color = await extractAverageColor(albumArt);

            if (
                !disposed
                && currentRequestId === requestId
                && loadedAlbumArt === albumArt
            ) {
                setAverageColor(color);
            }
        };

        void updateAverageColor();

        const unsubscribePlayer = player.subscribe(() => {
            void updateAverageColor();
        });

        const unsubscribeTrackChange = player.subscribeToTrackChange(() => {
            void updateAverageColor();
        });

        return () => {
            disposed = true;
            requestId++;
            unsubscribePlayer();
            unsubscribeTrackChange();
        };
    }, []);

    const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const container = containerRef.current;
        const dashboard = container?.closest('.dashboard-hor') as HTMLElement | null;
        if (!container || !dashboard) return;

        resizingRef.current = {
            startX: event.clientX,
            startWidth: container.getBoundingClientRect().width,
            maxWidth: Math.max(SIDETAB_MIN_WIDTH, Math.floor(dashboard.clientWidth / 2)),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.body.classList.add('lyrics-sidetab-resizing');
    };

    const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
        const resizing = resizingRef.current;
        if (!resizing) return;

        const delta = resizing.startX - event.clientX;
        pendingResizeWidthRef.current = Math.min(
            Math.max(SIDETAB_MIN_WIDTH, resizing.startWidth + delta),
            resizing.maxWidth,
        );

        if (resizeFrameRef.current !== null) return;
        resizeFrameRef.current = window.requestAnimationFrame(() => {
            resizeFrameRef.current = null;
            const container = containerRef.current;
            if (!container || !resizingRef.current) return;
            container.style.width = `${pendingResizeWidthRef.current}px`;
            setSideTabWidthState(setSideTabWidth(pendingResizeWidthRef.current));
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
        setSideTabWidthState(setSideTabWidth(finalWidth));
        event.currentTarget.releasePointerCapture(event.pointerId);
        document.body.classList.remove('lyrics-sidetab-resizing');
    };

    const loadedLyrics = lyricsState.status === 'loaded' ? lyricsState.lyrics : null;
    const hasSyncedLyrics = Boolean(loadedLyrics?.syncedLyrics);
    const notFoundMessageId = (hashString(currentTrackKey() ?? 'idle') % NOT_FOUND_MESSAGE_COUNT) + 1;

    const containerStyle = {
        '--lyrics-sidetab-width': `${sideTabWidth}px`,
        ...(averageColor ? {
            backgroundColor: averageColor.color,
            '--lyrics-text-a0': averageColor.textA0,
            '--lyrics-text-a20': averageColor.textA20,
            '--lyrics-text-a30': averageColor.textA30,
            '--lyrics-text-a40': averageColor.textA40,
        } : {}),
    } as CSSProperties;

    return (
        <div
            className={`lyrics-sidetab-container${lyricsTransition.switching ? ' lyrics-sidetab-container-switching' : ''}${lyricsTransition.closing ? ' lyrics-sidetab-container-closing' : ''}${lyricsTransition.hidden ? ' lyrics-sidetab-container-hidden' : ''}${lyricsTransition.collapsed ? ' lyrics-sidetab-container-collapsed' : ''}`}
            ref={containerRef}
            style={containerStyle}
            aria-hidden={!lyricsVisible}
        >
            {lyricsVisible && (
                <div
                    className='lyrics-sidetab-resize-handle'
                    onPointerDown={startResize}
                    onPointerMove={resize}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    role='separator'
                    aria-orientation='vertical'
                />
            )}
            {hasSyncedLyrics && !isFollowingLyrics && (
                <button
                    className='lyrics-sync-button'
                    type='button'
                    onClick={() => setSyncRequest(request => request + 1)}
                    aria-label={t('lyrics.sync')}
                    title={t('lyrics.sync')}
                >
                    <AudioLines className='lyrics-sync-button-icon' />
                    {t('lyrics.sync')}
                </button>
            )}
            {lyricsState.status === 'loading' ? (
                <div className='lyrics-loading' aria-label={t('lyrics.loading')}>
                    <LoaderCircle />
                </div>
            ) : loadedLyrics?.syncedLyrics || loadedLyrics?.plainLyrics ? (
                <>
                    <Lyrics
                        syncedLyrics={loadedLyrics.syncedLyrics}
                        plainLyrics={loadedLyrics.plainLyrics}
                        lyricsVisible={lyricsVisible}
                        syncRequest={syncRequest}
                        onFollowingChange={setIsFollowingLyrics}
                    />
                    <p className='lyrics-provider'>
                        {t('lyrics.provider.prefix')}{' '}
                        <a href='https://lrclib.net/' target='_blank' rel='noreferrer'>
                            {t('lyrics.provider.name')}
                        </a>
                    </p>
                </>
            ) : (
                <div className='lyrics-sidetab-placeholder'>
                    <span className='lyrics-not-found'>{t(`lyrics.not_found.${notFoundMessageId}`)}</span>
                </div>
            )}
        </div>
    )
}

export default LyricsView;
