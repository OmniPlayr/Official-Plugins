import { useParams } from "react-router-dom";
import translations from ".";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Clock, Code2, Copy, Disc3, ListPlus, LoaderCircle, Pause, Play, Search, Share2, Shuffle, User, Volume2 } from "lucide-react";
import { Tooltip } from "react-tooltip";
import './styles/Playlist.css';
import liked from './assets/liked.svg';
import unknownArt from '../../assets/images/unknown-art.svg';
import unknownAvatar from '../../assets/images/unknown-profile.svg';

import {
    api,
    getAccount,
    player,
    type QueueItem,
    useIsMobile,
    closePopup,
    createPopup,
    hasFrontendPlugin,
    navigate,
} from '@omniplayr/plugins';

type UserAccount = {
    id: string | number;
    name: string;
};

type Collaborator = {
    account_id: string | number;
    permission: string;
    name: string;
    avatar: string | null;
}

export type PlaylistSongMetadata = {
    title: string;
    artist: string;
    album: string;
    album_artist: string;
    year: string | number | null;
    track: string | number | null;
    duration: number;
    album_art: string | null;
    explicit: boolean;
};

export type PlaylistSong = {
    source_type: string;
    song_id: string;
    path: string | null;
    position: number;
    added_at: string | null;
    added_by: string | number | null;
    added_by_name: string | null;
    added_by_picture: string | null;
    spotify_uri: string | null;
    metadata: PlaylistSongMetadata;
};

type ArtistPageInfo = {
    artist_exists: boolean;
    album_exists: boolean;
    artist_url: string;
    album_url: string;
};

type Playlist = {
    id: string | number;
    service: string;
    name: string;
    cover: string | null;
    description: string | null;
    created_at: string;
    updated_at: string;
    private: boolean;
    owner_id: number;
    is_liked_playlist: boolean;
    created_by: number | null;
    created_by_name: string | null;
    created_by_avatar: string | null;
    collaborators: Collaborator[];
};

type PlaylistCache = {
    account?: UserAccount;
    accountRequest?: Promise<UserAccount>;
    playlists: Map<string, Playlist>;
    songs: Map<string, PlaylistSong[]>;
    playlistRequests: Map<string, Promise<Playlist>>;
};

type PlaylistPlayerState = {
    songId: string | null;
    sourceType: string | null;
    queueName: string | null;
    isPlaying: boolean;
    shuffle: boolean;
};

type SongContextMenu = {
    song: PlaylistSong;
    x: number;
    y: number;
} | null;

const playlistCache = new Map<string, PlaylistCache>();
const COLLABORATOR_LIMIT = 2;
const SONG_STATE_BATCH_SIZE = 50;
const SONG_LONG_PRESS_MS = 520;
const SONG_LONG_PRESS_MOVE_TOLERANCE = 12;
const SONG_ACTIONS_POPUP_GROUP = 'playlist-song-actions';
const SONG_ACTIONS_POPUP_ID = 'playlist-song-actions-main';
const SONG_SHARE_POPUP_ID = 'playlist-song-actions-share';
const EMPTY_ARTIST_PAGE: ArtistPageInfo = {
    artist_exists: false,
    album_exists: false,
    artist_url: '',
    album_url: '',
};
const artistPageCache = new Map<string, ArtistPageInfo>();
const artistPageRequests = new Map<string, Promise<ArtistPageInfo>>();

function formatDateAdded(value: string | null, locale?: string) {
    if (!value) return '\u2014';

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '\u2014';

    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function formatDuration(value: number) {
    if (!Number.isFinite(value) || value < 0) return '\u2014';

    const totalSeconds = Math.floor(value);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return hours > 0
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function queueItem(song: PlaylistSong, playlist: Playlist): QueueItem {
    return {
        songId: song.song_id,
        sourceType: song.source_type,
        extra: {
            artist: song.metadata.artist,
            title: song.metadata.title,
            album: song.metadata.album,
            spotifyUri: song.spotify_uri,
            playlistService: playlist.service,
            playlistId: playlist.id,
        },
    };
}

function readPlayerState(): PlaylistPlayerState {
    return {
        songId: player.currentSongId,
        sourceType: player.currentSourceType,
        queueName: player.queueName,
        isPlaying: player.isPlaying,
        shuffle: player.shuffle,
    };
}

function getCache() {
    const key = getAccount() ?? 'no-account';
    let cache = playlistCache.get(key);

    if (!cache) {
        cache = {
            playlists: new Map(),
            songs: new Map(),
            playlistRequests: new Map(),
        };
        playlistCache.set(key, cache);
    }

    return cache;
}

function account(cache: PlaylistCache) {
    if (cache.account) return Promise.resolve(cache.account);
    if (cache.accountRequest) return cache.accountRequest;

    cache.accountRequest = api('get_account', undefined, { account_id: 'me' })
        .then((response) => {
            cache.account = response as UserAccount;
            return cache.account;
        })
        .finally(() => {
            cache.accountRequest = undefined;
        });

    return cache.accountRequest;
}

function getPlaylist(
    cache: PlaylistCache,
    id: string | number,
    onPlaylist: (playlist: Playlist) => void,
    onSongs: (songs: PlaylistSong[]) => void,
    onUser: (user: UserAccount) => void,
) {
    const playlistId = String(id);

    if (cache.playlistRequests.has(playlistId)) return cache.playlistRequests.get(playlistId)!;

    const request = (async () => {
        let receivedPlaylist = cache.playlists.get(playlistId) ?? null;
        const songKey = (song: PlaylistSong) => `${song.source_type}:${song.song_id}`;
        const receivedSongs: PlaylistSong[] = [...(cache.songs.get(playlistId) ?? [])];
        const freshSongs: PlaylistSong[] = [];
        const cachedOccurrenceCounts = new Map<string, number>();
        const freshOccurrenceCounts = new Map<string, number>();
        const receivedIndexesByKey = new Map<string, number[]>();
        receivedSongs.forEach((song, index) => {
            const key = songKey(song);
            const indexes = receivedIndexesByKey.get(key) ?? [];
            indexes.push(index);
            receivedIndexesByKey.set(key, indexes);
        });
        let sawCachedSongs = receivedSongs.length > 0;
        let pendingSongChanges = 0;
        const imageAssets = new Map<string, string>();

        const renderPendingSongs = (force = false) => {
            if (pendingSongChanges === 0) return;
            if (!force && pendingSongChanges < SONG_STATE_BATCH_SIZE) return;

            pendingSongChanges = 0;
            onSongs([...receivedSongs]);
        };

        const resolveImage = (image: unknown) => {
            if (typeof image === 'string') return image;
            if (!image || typeof image !== 'object' || !('asset_id' in image)) return null;
            return imageAssets.get(String(image.asset_id)) ?? null;
        };

        try {
            const response = await api(
                `/plugin/playlists/me/${id}/stream`,
                undefined,
                undefined,
                true,
                true,
            ) as Response;
            if (!response.body) throw new Error('Playlist stream has no response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const consumeLine = (line: string) => {
                if (!line.trim()) return false;
                const event = JSON.parse(line) as {
                    type: string;
                    playlist?: Playlist;
                    user?: UserAccount;
                    song?: Omit<PlaylistSong, 'added_by_picture' | 'metadata'> & {
                        added_by_picture: unknown;
                        metadata: Omit<PlaylistSongMetadata, 'album_art'> & { album_art: unknown };
                    };
                    cached?: boolean;
                    images?: { id: string; asset: string }[];
                };
                event.images?.forEach(({ id, asset }) => imageAssets.set(id, asset));
                if (event.type === 'start' && event.user) {
                    cache.account = event.user;
                    onUser(event.user);
                } else if (event.type === 'playlist' && event.playlist) {
                    receivedPlaylist = event.playlist;
                    cache.playlists.set(playlistId, event.playlist);
                    onPlaylist(event.playlist);
                } else if (event.type === 'song' && event.song) {
                    const song: PlaylistSong = {
                        ...event.song,
                        added_by_picture: resolveImage(event.song.added_by_picture),
                        metadata: {
                            ...event.song.metadata,
                            album_art: resolveImage(event.song.metadata.album_art),
                        },
                    };
                    if (event.cached) {
                        sawCachedSongs = true;
                        const key = songKey(song);
                        const occurrence = cachedOccurrenceCounts.get(key) ?? 0;
                        cachedOccurrenceCounts.set(key, occurrence + 1);
                        const existingIndex = receivedIndexesByKey.get(key)?.[occurrence];
                        if (existingIndex === undefined) {
                            const indexes = receivedIndexesByKey.get(key) ?? [];
                            indexes.push(receivedSongs.length);
                            receivedIndexesByKey.set(key, indexes);
                            receivedSongs.push(song);
                        } else {
                            receivedSongs[existingIndex] = song;
                        }
                    } else {
                        freshSongs.push(song);
                        const key = songKey(song);
                        const occurrence = freshOccurrenceCounts.get(key) ?? 0;
                        freshOccurrenceCounts.set(key, occurrence + 1);
                        const existingIndex = receivedIndexesByKey.get(key)?.[occurrence];
                        if (existingIndex === undefined) {
                            const indexes = receivedIndexesByKey.get(key) ?? [];
                            indexes.push(receivedSongs.length);
                            receivedIndexesByKey.set(key, indexes);
                            receivedSongs.push(song);
                        } else {
                            receivedSongs[existingIndex] = song;
                        }
                    }
                    pendingSongChanges += 1;
                    cache.songs.set(playlistId, [...receivedSongs]);
                    return true;
                } else if (event.type === 'songs_done') {
                    renderPendingSongs(true);
                    if (event.cached === false) {
                        cache.songs.set(playlistId, [...freshSongs]);
                        if (!sawCachedSongs) onSongs([...freshSongs]);
                    }
                }
                return false;
            };

            while (true) {
                const { done, value } = await reader.read();
                buffer += decoder.decode(value, { stream: !done });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    if (consumeLine(line)) renderPendingSongs();
                }
                if (done) break;
            }
            consumeLine(buffer);
            renderPendingSongs(true);
        } catch {
            const fallbackUser = await account(cache);
            onUser(fallbackUser);
            receivedPlaylist = await api(`/plugin/playlists/${fallbackUser.id}/${id}`) as Playlist;
            cache.playlists.set(playlistId, receivedPlaylist);
            onPlaylist(receivedPlaylist);
        }

        if (!receivedPlaylist) throw new Error('Playlist was not returned by the stream');
        return receivedPlaylist;
    })()
        .finally(() => {
            cache.playlistRequests.delete(playlistId);
        });

    cache.playlistRequests.set(playlistId, request);
    return request;
}

function getSpotifyId(uri: string | null) {
    if (!uri) return null;

    const parts = uri.split(':');
    return parts.length >= 3 ? parts[2] : null;
}

function getSongShareLink(song: PlaylistSong) {
    if (song.source_type === 'spotify') {
        const spotifyId = getSpotifyId(song.spotify_uri);
        return spotifyId ? `https://open.spotify.com/track/${spotifyId}` : null;
    }

    if (song.path?.startsWith('http://') || song.path?.startsWith('https://')) {
        return song.path;
    }

    return null;
}

function getSongEmbed(song: PlaylistSong) {
    if (song.source_type === 'spotify') {
        const spotifyId = getSpotifyId(song.spotify_uri);
        return spotifyId
            ? `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/track/${spotifyId}" width="100%" height="152" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`
            : null;
    }

    return null;
}

async function hasArtistsPage(artist: string, album: string, song: string): Promise<ArtistPageInfo> {
    const cacheKey = `${artist}\u0000${album}\u0000${song}`;
    const cached = artistPageCache.get(cacheKey);
    if (cached) return cached;

    const pending = artistPageRequests.get(cacheKey);
    if (pending) return pending;

    if (!hasFrontendPlugin('artists@built-in')) {
        artistPageCache.set(cacheKey, EMPTY_ARTIST_PAGE);
        return EMPTY_ARTIST_PAGE;
    }

    const request = (async () => {
        const pageExists = await api(`/plugin/artists/exists?artist=${encodeURIComponent(artist)}&album=${encodeURIComponent(album)}&song=${encodeURIComponent(song)}`) as ArtistPageInfo;

        return {
            artist_exists: pageExists.artist_exists as boolean,
            album_exists: pageExists.album_exists as boolean,
            artist_url: '/artist/' + encodeURIComponent(artist),
            album_url: '/artist/' + encodeURIComponent(artist) + '/' + encodeURIComponent(album),
        };
    })();

    artistPageRequests.set(cacheKey, request);

    try {
        const artistPage = await request;
        artistPageCache.set(cacheKey, artistPage);
        return artistPage;
    } finally {
        artistPageRequests.delete(cacheKey);
    }
}

function getCachedArtistPage(song: PlaylistSong) {
    return artistPageCache.get(`${song.metadata.artist}\u0000${song.metadata.album}\u0000${song.metadata.title}`) ?? null;
}

function PlaylistSongContextMenu({
    menu,
    copiedContextAction,
    addSongToQueue,
    copyContextValue,
}: {
    menu: NonNullable<SongContextMenu>;
    copiedContextAction: string | null;
    addSongToQueue: (song: PlaylistSong) => void;
    copyContextValue: (action: string, value: string) => void;
}) {
    const { t } = translations.useTranslation();
    const shareLink = getSongShareLink(menu.song);
    const embed = getSongEmbed(menu.song);
    const canShare = menu.song.source_type !== 'local' && (shareLink || embed);
    const [artistPage, setArtistPage] = useState<ArtistPageInfo>(() => getCachedArtistPage(menu.song) ?? EMPTY_ARTIST_PAGE);

    useEffect(() => {
        let cancelled = false;

        hasArtistsPage(menu.song.metadata.artist, menu.song.metadata.album, menu.song.metadata.title).then((page) => {
            if (!cancelled) setArtistPage(page);
        });

        return () => {
            cancelled = true;
        };
    }, [menu.song]);

    return (
        <div
            className='playlist-song-context-menu'
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
        >
            <button className='playlist-song-context-menu-item' onClick={() => addSongToQueue(menu.song)}>
                <ListPlus className='playlist-song-context-menu-icon' />
                <span>{t('playlists.playlist.context.queue')}</span>
            </button>
            {artistPage.artist_exists || artistPage.album_exists || canShare ? <div className='playlist-song-context-menu-separator' /> : null}
            {artistPage.artist_exists && (
                <button className='playlist-song-context-menu-item' onClick={() => navigate(artistPage.artist_url)}>
                    <User className='playlist-song-context-menu-icon' />
                    <span>{t('playlists.playlist.context.artist')}</span>
                </button>
            )}
            {artistPage.album_exists && (
                <button className='playlist-song-context-menu-item' onClick={() => navigate(artistPage.album_url)}>
                    <Disc3 className='playlist-song-context-menu-icon' />
                    <span>{t('playlists.playlist.context.album')}</span>
                </button>
            )}
            {canShare && (
                <div className='playlist-song-context-menu-submenu'>
                    <button className='playlist-song-context-menu-item playlist-song-context-menu-submenu-trigger'>
                        <Share2 className='playlist-song-context-menu-icon' />
                        <span>{t('playlists.playlist.context.share')}</span>
                        <span className='playlist-song-context-menu-arrow'><ChevronRight className="playlist-song-context-menu-arrow-icon" /></span>
                    </button>
                    <div className='playlist-song-context-submenu'>
                        {shareLink && (
                            <button className='playlist-song-context-menu-item' onClick={() => copyContextValue('link', shareLink)}>
                                {copiedContextAction === 'link' ? <Check className='playlist-song-context-menu-icon' /> : <Copy className='playlist-song-context-menu-icon' />}
                                <span>{copiedContextAction === 'link' ? t('playlists.playlist.context.copied') : t('playlists.playlist.context.copy-link')}</span>
                            </button>
                        )}
                        {embed && (
                            <button className='playlist-song-context-menu-item' onClick={() => copyContextValue('embed', embed)}>
                                {copiedContextAction === 'embed' ? <Check className='playlist-song-context-menu-icon' /> : <Code2 className='playlist-song-context-menu-icon' />}
                                <span>{copiedContextAction === 'embed' ? t('playlists.playlist.context.copied') : t('playlists.playlist.context.copy-embed')}</span>
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function PlaylistSongActionsPopup({
    song,
    addSongToQueue,
    closeSongActionsPopup,
    openSongSharePopup,
}: {
    song: PlaylistSong;
    addSongToQueue: (song: PlaylistSong) => void;
    closeSongActionsPopup: () => void;
    openSongSharePopup: (song: PlaylistSong) => void;
}) {
    const { t } = translations.useTranslation();
    const shareLink = getSongShareLink(song);
    const embed = getSongEmbed(song);
    const canShare = song.source_type !== 'local' && (shareLink || embed);
    const [artistPage, setArtistPage] = useState<ArtistPageInfo>(() => getCachedArtistPage(song) ?? EMPTY_ARTIST_PAGE);

    useEffect(() => {
        if (getCachedArtistPage(song)) return;

        let cancelled = false;

        hasArtistsPage(song.metadata.artist, song.metadata.album, song.metadata.title).then((page) => {
            if (!cancelled) setArtistPage(page);
        });

        return () => {
            cancelled = true;
        };
    }, [song]);

    return (
        <div className='playlist-song-popup-actions'>
            <button
                className='playlist-song-popup-action'
                onClick={() => {
                    addSongToQueue(song);
                    closeSongActionsPopup();
                }}
            >
                <ListPlus className='playlist-song-popup-action-icon' />
                <span>{t('playlists.playlist.context.queue')}</span>
            </button>
            {artistPage.artist_exists && (
                <button className='playlist-song-popup-action' onClick={() => navigate(artistPage.artist_url)}>
                    <User className='playlist-song-popup-action-icon' />
                    <span>{t('playlists.playlist.context.artist')}</span>
                </button>
            )}
            {artistPage.album_exists && (
                <button className='playlist-song-popup-action' onClick={() => navigate(artistPage.album_url)}>
                    <Disc3 className='playlist-song-popup-action-icon' />
                    <span>{t('playlists.playlist.context.album')}</span>
                </button>
            )}
            {canShare && (
                <button className='playlist-song-popup-action' onClick={() => openSongSharePopup(song)}>
                    <Share2 className='playlist-song-popup-action-icon' />
                    <span>{t('playlists.playlist.context.share')}</span>
                    <ChevronRight className='playlist-song-popup-action-chevron' />
                </button>
            )}
        </div>
    );
}

function Playlist() {
    const { id } = useParams() as { id: string | number };
    const { t, i18n } = translations.useTranslation();
    const [cache] = useState(getCache);
    const [, setUserAccount] = useState<UserAccount | null>(cache.account ?? null);
    const [playlist, setPlaylist] = useState<Playlist | null>(cache.playlists.get(String(id)) ?? null);
    const [songs, setSongs] = useState<PlaylistSong[]>(cache.songs.get(String(id)) ?? []);
    const [collaboratorsExpanded, setCollaboratorsExpanded] = useState(false);
    const [playerState, setPlayerState] = useState(readPlayerState);
    const searchDebounceRef = useRef<number | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [songContextMenu, setSongContextMenu] = useState<SongContextMenu>(null);
    const [copiedContextAction, setCopiedContextAction] = useState<string | null>(null);
    const [stickyVisible, setStickyVisible] = useState(false);
    const isMobile = useIsMobile();
    const pageContainerRef = useRef<HTMLDivElement>(null);
    const stickyHeaderRef = useRef<HTMLDivElement>(null);
    const stickyTableHeaderRef = useRef<HTMLTableRowElement>(null);
    const tableHeaderRef = useRef<HTMLTableRowElement>(null);
    const playlistPlayRef = useRef<HTMLDivElement>(null);
    const longPressTimerRef = useRef<number | null>(null);
    const longPressStartRef = useRef({ x: 0, y: 0 });
    const suppressNextSongClickRef = useRef(false);

    useEffect(() => {
        getPlaylist(cache, id, setPlaylist, setSongs, setUserAccount).then(setPlaylist);
    }, [cache, id]);

    useEffect(() => player.subscribe(() => {
        const next = readPlayerState();
        setPlayerState(current => (
            current.songId === next.songId
            && current.sourceType === next.sourceType
            && current.queueName === next.queueName
            && current.isPlaying === next.isPlaying
            && current.shuffle === next.shuffle
        ) ? current : next);
    }), []);

    useEffect(() => () => {
        if (searchDebounceRef.current) {
            window.clearTimeout(searchDebounceRef.current);
        }
        if (longPressTimerRef.current) {
            window.clearTimeout(longPressTimerRef.current);
        }
    }, []);

    useEffect(() => {
        if (!songContextMenu) return;

        const close = () => setSongContextMenu(null);
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') close();
        };

        window.addEventListener('click', close);
        window.addEventListener('scroll', close, true);
        window.addEventListener('keydown', closeOnEscape);

        return () => {
            window.removeEventListener('click', close);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('keydown', closeOnEscape);
        };
    }, [songContextMenu]);

    useEffect(() => {
        const el = playlistPlayRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setStickyVisible(!entry.isIntersecting),
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [playlist]);

    useEffect(() => {
        const pageEl = pageContainerRef.current;
        const stickyEl = stickyHeaderRef.current;
        const stickyTableHeaderEl = stickyTableHeaderRef.current;
        const tableHeaderEl = tableHeaderRef.current;
        const scrollEl = pageEl?.closest('.dashboard-main') as HTMLElement | null;

        if (!pageEl || !stickyEl || !stickyTableHeaderEl || !tableHeaderEl || !scrollEl) return;

        const syncStickyHeaderPosition = () => {
            const rect = scrollEl.getBoundingClientRect();
            const styles = window.getComputedStyle(scrollEl);
            const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
            const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
            const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;

            stickyEl.style.setProperty('--playlist-header-top', `${rect.top + borderTop}px`);
            stickyEl.style.setProperty('--playlist-header-left', `${rect.left + borderLeft}px`);
            stickyEl.style.setProperty('--playlist-header-width', `${rect.width - borderLeft - borderRight}px`);

            const stickyRect = stickyEl.getBoundingClientRect();
            const tableHeaderRect = tableHeaderEl.getBoundingClientRect();
            stickyEl.style.setProperty('--playlist-sticky-table-left', `${tableHeaderRect.left - stickyRect.left}px`);
            stickyEl.style.setProperty('--playlist-sticky-table-width', `${tableHeaderRect.width}px`);

            const sourceCells = Array.from(tableHeaderEl.children) as HTMLElement[];
            const stickyCells = Array.from(stickyTableHeaderEl.children) as HTMLElement[];

            sourceCells.forEach((sourceCell, index) => {
                const stickyCell = stickyCells[index];
                if (!stickyCell) return;

                const sourceStyles = window.getComputedStyle(sourceCell);
                const hidden = sourceStyles.display === 'none';

                stickyCell.style.display = hidden ? 'none' : sourceStyles.display;
                stickyCell.style.width = hidden ? '' : `${sourceCell.getBoundingClientRect().width}px`;
                stickyCell.style.flex = hidden ? '' : '0 0 auto';
            });
        };

        syncStickyHeaderPosition();

        const resizeObserver = new ResizeObserver(syncStickyHeaderPosition);
        resizeObserver.observe(scrollEl);
        resizeObserver.observe(pageEl);
        resizeObserver.observe(tableHeaderEl);

        window.addEventListener('resize', syncStickyHeaderPosition);
        scrollEl.addEventListener('scroll', syncStickyHeaderPosition, { passive: true });

        return () => {
            resizeObserver.disconnect();
            window.removeEventListener('resize', syncStickyHeaderPosition);
            scrollEl.removeEventListener('scroll', syncStickyHeaderPosition);
        };
    }, [playlist]);

    const searchableSongs = useMemo(() => songs.map((song) => ({
        song,
        searchText: [
            song.metadata.title,
            song.metadata.artist,
            song.metadata.album,
            song.metadata.album_artist,
            song.song_id,
        ].map((value) => String(value ?? '').toLowerCase()).join(' '),
    })), [songs]);

    const filteredSongs = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();

        if (!query) return songs;

        return searchableSongs
            .filter(({ searchText }) => searchText.includes(query))
            .map(({ song }) => song);
    }, [songs, searchableSongs, searchQuery]);

    if (!playlist) {
        return (
            <div className="playlist-loading"><LoaderCircle /></div>
        );
    }

    const collaborators = playlist?.collaborators ?? [];
    const collapsed = !collaboratorsExpanded;
    const visibleCollaborators = collapsed ? collaborators.slice(0, COLLABORATOR_LIMIT) : collaborators;
    const remainingCount = collaborators.length - COLLABORATOR_LIMIT;
    const playlistQueueName = `playlist:${playlist.service}:${playlist.id}`;
    const playlistIsActive = playerState.queueName === playlistQueueName
        && songs.some(song => song.song_id === playerState.songId && song.source_type === playerState.sourceType);

    const startPlaylist = async (startIndex: number, shuffled: boolean) => {
        if (songs.length === 0) return;

        const resolvedIndex = Math.max(0, Math.min(startIndex, songs.length - 1));
        const selected = queueItem(songs[resolvedIndex], playlist);
        const remainingSongs = shuffled
            ? songs.filter((_, index) => index !== resolvedIndex)
            : songs.slice(resolvedIndex + 1);

        player.clearPriorityQueue();
        player.clearNextQueue();
        if (player.shuffle !== shuffled) player.toggleShuffle();

        const playback = player.playSong(selected.songId, selected.sourceType, selected.extra, true);
        player.setNextQueue(playlistQueueName, remainingSongs.map(song => queueItem(song, playlist)));
        await playback;
    };

    const toggleOrPlayPlaylist = () => {
        if (playlistIsActive) {
            player.togglePlay();
            return;
        }
        void startPlaylist(0, false);
    };

    const playSongFromPlaylist = (song: PlaylistSong, index: number) => {
        const isCurrent = playerState.songId === song.song_id && playerState.sourceType === song.source_type;
        if (playlistIsActive && isCurrent) {
            player.togglePlay();
            return;
        }
        if (index === -1) return;

        void startPlaylist(index, false);
    };

    const addSongToQueue = (song: PlaylistSong) => {
        const item = queueItem(song, playlist);
        player.addToQueue(item.songId, item.sourceType, item.extra);
        setSongContextMenu(null);
    };

    const closeSongActionsPopup = () => {
        closePopup(SONG_ACTIONS_POPUP_ID);
        closePopup(SONG_SHARE_POPUP_ID);
    };

    const copyContextValue = async (action: string, value: string) => {
        await navigator.clipboard.writeText(value);
        setCopiedContextAction(action);
        window.setTimeout(() => setCopiedContextAction(null), 1200);
    };

    const copyMobileContextValue = async (action: string, value: string) => {
        await copyContextValue(action, value);
        closeSongActionsPopup();
    };

    const openSongSharePopup = (song: PlaylistSong) => {
        const shareLink = getSongShareLink(song);
        const embed = getSongEmbed(song);

        createPopup({
            id: SONG_SHARE_POPUP_ID,
            group: SONG_ACTIONS_POPUP_GROUP,
            navigationIndex: 1,
            title: t('playlists.playlist.context.share'),
            subtitle: song.metadata.title,
            close_button: true,
            mobileFullscreen: false,
            content: (
                <div className='playlist-song-popup-actions'>
                    <button className='playlist-song-popup-action' onClick={() => openSongActionsPopup(song)}>
                        <ChevronLeft className='playlist-song-popup-action-icon' />
                        <span>Back</span>
                    </button>
                    {shareLink && (
                        <button className='playlist-song-popup-action' onClick={() => copyMobileContextValue('link', shareLink)}>
                            <Copy className='playlist-song-popup-action-icon' />
                            <span>{t('playlists.playlist.context.copy-link')}</span>
                        </button>
                    )}
                    {embed && (
                        <button className='playlist-song-popup-action' onClick={() => copyMobileContextValue('embed', embed)}>
                            <Code2 className='playlist-song-popup-action-icon' />
                            <span>{t('playlists.playlist.context.copy-embed')}</span>
                        </button>
                    )}
                </div>
            ),
        });
    };

    const openSongActionsPopup = (song: PlaylistSong) => {
        createPopup({
            id: SONG_ACTIONS_POPUP_ID,
            group: SONG_ACTIONS_POPUP_GROUP,
            navigationIndex: 0,
            title: song.metadata.title,
            subtitle: song.metadata.artist,
            close_button: true,
            mobileFullscreen: false,
            content: (
                <PlaylistSongActionsPopup
                    song={song}
                    addSongToQueue={addSongToQueue}
                    closeSongActionsPopup={closeSongActionsPopup}
                    openSongSharePopup={openSongSharePopup}
                />
            ),
        });
    };

    const clearSongLongPress = () => {
        if (!longPressTimerRef.current) return;
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
    };

    const startSongLongPress = (event: ReactPointerEvent<HTMLTableRowElement>, song: PlaylistSong) => {
        if (!isMobile || event.pointerType === 'mouse') return;

        clearSongLongPress();
        longPressStartRef.current = { x: event.clientX, y: event.clientY };
        longPressTimerRef.current = window.setTimeout(() => {
            longPressTimerRef.current = null;
            suppressNextSongClickRef.current = true;
            setSongContextMenu(null);
            openSongActionsPopup(song);
        }, SONG_LONG_PRESS_MS);
    };

    const moveSongLongPress = (event: ReactPointerEvent<HTMLTableRowElement>) => {
        if (!isMobile || !longPressTimerRef.current) return;

        const dx = Math.abs(event.clientX - longPressStartRef.current.x);
        const dy = Math.abs(event.clientY - longPressStartRef.current.y);
        if (dx > SONG_LONG_PRESS_MOVE_TOLERANCE || dy > SONG_LONG_PRESS_MOVE_TOLERANCE) {
            clearSongLongPress();
        }
    };

    const finishSongLongPress = () => {
        clearSongLongPress();
        if (suppressNextSongClickRef.current) {
            window.setTimeout(() => {
                suppressNextSongClickRef.current = false;
            }, 700);
        }
    };

    return (
        <div className="playlist-page-container" ref={pageContainerRef}>
            <div ref={stickyHeaderRef} className={'playlist-page-header-sticky' + (stickyVisible ? ' visible' : '')}>
                <div className="playlist-page-sticky-header-information">
                    <div className='playlist-actions-play' onClick={toggleOrPlayPlaylist} title={playlistIsActive && playerState.isPlaying ? 'Pause playlist' : 'Play playlist'}>
                        {playlistIsActive && playerState.isPlaying
                            ? <Pause className='playlist-actions-play-icon' />
                            : <Play className='playlist-actions-play-icon' />}
                    </div>
                    <div className='playlist-page-sticky-header-info'>
                        <img src={playlist?.is_liked_playlist ? liked : playlist?.cover ?? unknownArt} alt={playlist?.name} className='playlists-home-playlist-sticky-cover' />
                        <div className='playlists-home-playlist-name-header-sticky'>{playlist?.name}</div>
                    </div>
                </div>
                <table className='playlist-songs-table'>
                    <thead>
                        <tr className='playlist-songs-table-header' ref={stickyTableHeaderRef}>
                            <th className='playlist-songs-table-header-number'>#</th>
                            <th className='playlist-songs-table-header-title'>{t('playlists.playlist.songs.table.title')}</th>
                            <th className='playlist-songs-table-header-album'>{t('playlists.playlist.songs.table.album')}</th>
                            <th className='playlist-songs-table-header-date-added'>{t('playlists.playlist.songs.table.date-added')}</th>
                            <th className='playlist-songs-table-header-duration'><Clock className='playlist-songs-table-header-duration-icon' /></th>
                        </tr>
                    </thead>
                </table>
            </div>
            <div className='playlist-page-header'>
                <img src={playlist?.is_liked_playlist ? liked : playlist?.cover ?? unknownArt} alt={playlist?.name} className='playlists-playlist-cover' />
                <div className='playlists-home-playlist-info'>
                    <div className='playlists-home-playlist-publicity'>{playlist?.private ? t('playlists.publicity.private') : t('playlists.publicity.public')}</div>
                    <div className='playlists-home-playlist-name-page'>{playlist?.name}</div>
                    <div className='playlists-home-playlist-description'>{playlist?.description}</div>
                    <div className={`playlists-home-playlist-collaborators${collapsed ? ' closed' : ''}`}>
                        {
                            visibleCollaborators.map((collaborator) => (
                                <div
                                    className='playlists-home-playlist-collaborator'
                                    key={collaborator.account_id}
                                    data-tooltip-id='collaborator-tooltip'
                                    data-tooltip-content={`${collaborator.name} • ${t(`playlists.permissions.${collaborator.permission}`)}`}
                                >
                                    <img src={collaborator.avatar ?? unknownAvatar} alt={collaborator.name} className='playlists-home-playlist-collaborator-avatar' />
                                </div>
                            ))
                        }
                        {
                            collapsed && remainingCount > 0 && (
                                <div
                                    className='playlists-home-playlist-collaborator-more'
                                    onClick={() => setCollaboratorsExpanded(true)}
                                >
                                    +{remainingCount}
                                </div>
                            )
                        }
                    </div>
                    <Tooltip id='collaborator-tooltip' />
                </div>
            </div>
            <div className='playlist-actions'>
                <div className='playlist-actions-left'>
                    <div className='playlist-actions-play' onClick={toggleOrPlayPlaylist} ref={playlistPlayRef} title={playlistIsActive && playerState.isPlaying ? 'Pause playlist' : 'Play playlist'}>
                        {playlistIsActive && playerState.isPlaying
                            ? <Pause className='playlist-actions-play-icon' />
                            : <Play className='playlist-actions-play-icon' />}
                    </div>
                    <div className={`playlist-actions-shuffle${playlistIsActive && playerState.shuffle ? ' active' : ''}`} onClick={() => void startPlaylist(Math.floor(Math.random() * songs.length), true)} title='Shuffle playlist'>
                        <Shuffle className='playlist-actions-shuffle-icon' />
                    </div>
                </div>
                <div className='playlist-actions-right'>
                    <div className='playlist-actions-search'>
                        <Search className='playlist-actions-search-icon' />
                        <input
                            type='text'
                            placeholder={t('playlists.playlist.search.placeholder')}
                            className='playlist-actions-search-input'
                            defaultValue={searchQuery}
                            onChange={(event) => {
                                const value = event.currentTarget.value;

                                if (searchDebounceRef.current) {
                                    window.clearTimeout(searchDebounceRef.current);
                                }

                                searchDebounceRef.current = window.setTimeout(() => {
                                    setSearchQuery(value);
                                }, 150);
                            }}
                        />
                    </div>
                </div>
            </div>
            <div className='playlist-songs'>
                <table className='playlist-songs-table'>
                    <thead>
                        <tr className='playlist-songs-table-header' ref={tableHeaderRef}>
                            <th className='playlist-songs-table-header-number'>#</th>
                            <th className='playlist-songs-table-header-title'>{t('playlists.playlist.songs.table.title')}</th>
                            <th className='playlist-songs-table-header-album'>{t('playlists.playlist.songs.table.album')}</th>
                            <th className='playlist-songs-table-header-date-added'>{t('playlists.playlist.songs.table.date-added')}</th>
                            <th className='playlist-songs-table-header-duration'><Clock className='playlist-songs-table-header-duration-icon' /></th>
                        </tr>
                    </thead>
                    <tbody>
                        {
                            filteredSongs.map((song) => {
                                const isCurrent = playerState.songId === song.song_id && playerState.sourceType === song.source_type;
                                const isPlaying = isCurrent && playerState.isPlaying;
                                const index = songs.indexOf(song);

                                return (
                                <tr
                                    className={`playlist-songs-table-row${isCurrent ? ' current' : ''}`}
                                    key={`${song.source_type}:${song.song_id}:${song.position}`}
                                    onClick={() => {
                                        if (suppressNextSongClickRef.current) {
                                            suppressNextSongClickRef.current = false;
                                            return;
                                        }
                                        if (index !== -1) playSongFromPlaylist(song, index);
                                    }}
                                    onPointerDown={(event) => startSongLongPress(event, song)}
                                    onPointerMove={moveSongLongPress}
                                    onPointerUp={finishSongLongPress}
                                    onPointerCancel={finishSongLongPress}
                                    onPointerLeave={finishSongLongPress}
                                    onContextMenu={(event) => {
                                        event.preventDefault();
                                        if (isMobile) return;
                                        setCopiedContextAction(null);
                                        setSongContextMenu({
                                            song,
                                            x: event.clientX,
                                            y: event.clientY,
                                        });
                                    }}
                                >
                                    <td className='playlist-songs-table-row-number'>
                                        <span className='playlist-song-number'>{song.position + 1}</span>
                                        {isCurrent && <Volume2 className='playlist-song-playing-indicator' />}
                                        <span className='playlist-song-hover-control'>
                                            {isPlaying ? <Pause /> : <Play />}
                                        </span>
                                    </td>
                                    <td className='playlist-songs-table-row-title'>
                                        <img src={song.metadata.album_art ?? unknownArt} alt={song.metadata?.title} className='playlist-songs-table-row-title-cover' />
                                        <div className='playlist-songs-table-row-title-info'>
                                            <div className='playlist-songs-table-row-title-name'>{song.metadata.title}</div>
                                            <div className='playlist-songs-table-row-title-artist'>{song.metadata.artist}</div>
                                        </div>
                                    </td>
                                    <td className='playlist-songs-table-row-album'>{song.metadata.album}</td>
                                    <td className='playlist-songs-table-row-date-added'>{formatDateAdded(song.added_at, i18n.resolvedLanguage)}</td>
                                    <td className='playlist-songs-table-row-duration'>{formatDuration(song.metadata.duration)}</td>
                                </tr>
                                );
                            })
                        }

                        {songContextMenu && (
                            <PlaylistSongContextMenu
                                key={`${songContextMenu.song.source_type}:${songContextMenu.song.song_id}:${songContextMenu.x}:${songContextMenu.y}`}
                                menu={songContextMenu}
                                copiedContextAction={copiedContextAction}
                                addSongToQueue={addSongToQueue}
                                copyContextValue={copyContextValue}
                            />
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default Playlist;
