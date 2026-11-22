import './styles/Sidebar.css';
import translations from './translations';
import { useEffect, useMemo, useReducer, useState } from 'react';
import liked from './assets/liked.svg';
import unknownArt from '../../assets/images/unknown-art.svg';
import { Pause, Play, Plus, Search } from 'lucide-react';

import {
    api,
    getAccount,
    navigate,
    player,
    type QueueItem,
} from '@omniplayr/plugins';
import { Tooltip } from 'react-tooltip';

export type UserAccount = {
    id: string | number;
    name: string;
};

export type Playlist = {
    id: string | number;
    service: string;
    name: string;
    cover?: string | null;
    is_liked_playlist: boolean;
    created_by: string | number | null;
    created_by_name: string;
};

export type PlaylistsResponse = {
    playlists: Playlist[];
};

export type FrequentEntry = {
    playlist_id: string | number;
    service: string;
};

export type SidebarPlaylistsResponse = {
    playlists: Playlist[];
    frequent?: FrequentEntry[];
};

export type PlaylistSongMetadata = {
    title: string;
    artist: string;
    album: string;
};

export type PlaylistSong = {
    source_type: string;
    song_id: string;
    position?: number;
    spotify_uri: string | null;
    metadata: PlaylistSongMetadata;
};

type CreatePlaylistResponse = {
    message: string;
    playlist?: Playlist;
}

const SERVICES = ['local', 'spotify', 'soundcloud', 'youtube'] as const;
type Service = typeof SERVICES[number];

export type SidebarCache = {
    key: string;
    account?: UserAccount;
    accountRequest?: Promise<UserAccount>;
    playlists?: Playlist[];
    byService: Partial<Record<Service, Playlist[]>>;
    sidebarRequest?: Promise<SidebarPlaylistsResponse>;
    recentKeys: string[];
    live: Set<Service>;
    known: Map<string, Playlist>;
    songs?: Map<string, PlaylistSong[]>;
    songRequests?: Map<string, Promise<PlaylistSong[]>>;
};

const sidebarCache = new Map<string, SidebarCache>();
const LEGACY_CACHE_PREFIX = 'omniplayr:playlist-sidebar:';
const PERSISTENT_CACHE_PREFIX = 'omniplayr:sidebar:';
const KNOWN_LIMIT = 80;
let prunedLegacyCaches = false;

function pruneLegacyCaches() {
    if (prunedLegacyCaches) return;
    prunedLegacyCaches = true;
    try {
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (key?.startsWith(LEGACY_CACHE_PREFIX)) {
                localStorage.removeItem(key);
                index -= 1;
            }
        }
    } catch {
    }
}

const stripHeavy = (playlist: Playlist): Playlist => (
    playlist.cover?.startsWith('data:') ? { ...playlist, cover: null } : playlist
);

function persist(cache: SidebarCache) {
    try {
        localStorage.setItem(PERSISTENT_CACHE_PREFIX + cache.key, JSON.stringify({
            byService: Object.fromEntries(
                Object.entries(cache.byService).map(([service, list]) => [service, (list ?? []).map(stripHeavy)]),
            ),
            known: [...cache.known.values()].map(stripHeavy),
            recentKeys: cache.recentKeys,
        }));
    } catch {
    }
}

function loadPersisted(cache: SidebarCache) {
    try {
        const raw = localStorage.getItem(PERSISTENT_CACHE_PREFIX + cache.key);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.byService && typeof data.byService === 'object') cache.byService = data.byService;
        if (Array.isArray(data.known)) {
            data.known.forEach((playlist: Playlist) => cache.known.set(playlistKey(playlist), playlist));
        }
        if (Array.isArray(data.recentKeys)) cache.recentKeys = data.recentKeys.filter((key: unknown) => typeof key === 'string');
    } catch {
    }
}

function remember(cache: SidebarCache, playlists: Playlist[]) {
    playlists.forEach(playlist => {
        const key = playlistKey(playlist);
        cache.known.delete(key);
        cache.known.set(key, playlist);
    });
    while (cache.known.size > KNOWN_LIMIT) {
        const oldest = cache.known.keys().next().value;
        if (oldest === undefined) break;
        cache.known.delete(oldest);
    }
}

function flatten(cache: SidebarCache) {
    const byKey = new Map(SERVICES.flatMap(service => cache.byService[service] ?? []).map(playlist => [playlistKey(playlist), playlist]));
    const recent: Playlist[] = [];

    cache.recentKeys.forEach(key => {
        const playlist = byKey.get(key);
        if (!playlist) return;
        recent.push(playlist);
        byKey.delete(key);
    });

    cache.playlists = [...recent, ...byKey.values()];
    return cache.playlists;
}

function getCache(accountToken: string | null = getAccount()) {
    const key = accountToken ?? 'no-account';
    let cache = sidebarCache.get(key);

    if (!cache) {
        pruneLegacyCaches();
        cache = {
            key,
            byService: {},
            recentKeys: [],
            live: new Set(),
            known: new Map(),
            songs: new Map(),
            songRequests: new Map(),
        };
        loadPersisted(cache);
        flatten(cache);
        sidebarCache.set(key, cache);
    }
    cache.songs ??= new Map();
    cache.songRequests ??= new Map();

    return cache;
}

export function account(cache: SidebarCache) {
    if (cache.account) return Promise.resolve(cache.account);
    if (cache.accountRequest) return cache.accountRequest;

    cache.accountRequest = api('/accounts/me')
        .then((response) => {
            cache.account = response as UserAccount;
            return cache.account;
        })
        .finally(() => {
            cache.accountRequest = undefined;
        });

    return cache.accountRequest;
}

export function playlistKey(playlist: Playlist) {
    return `${playlist.service}:${playlist.id}`;
}

export function playlistRouteId(playlist: Playlist) {
    return `${playlist.id}${playlist.service === 'local' ? '' : `:${playlist.service}`}`;
}

export function playlistQueueName(playlist: Playlist) {
    return `playlist:${playlist.service}:${playlist.id}`;
}

export function queueItem(song: PlaylistSong, playlist: Playlist): QueueItem {
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
            playlistName: playlist.name,
            playlistPosition: song.position,
        },
    };
}

export async function getPlaylistSongs(cache: SidebarCache, playlist: Playlist, onUpdate?: (songs: PlaylistSong[]) => void) {
    const key = playlistKey(playlist);
    if (cache.songs?.has(key)) return cache.songs.get(key)!;
    if (cache.songRequests?.has(key)) return cache.songRequests.get(key)!;

    const request = (async () => {
        const response = await api(
            `/plugin/playlists/me/${playlistRouteId(playlist)}/stream`,
            undefined,
            undefined,
            true,
            true,
        ) as Response;
        if (!response.body) throw new Error('Playlist stream has no response body');

        const songs: PlaylistSong[] = [];
        const songIndexes = new Map<string, number>();
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const consumeLine = (line: string) => {
            if (!line.trim()) return;
            const event = JSON.parse(line) as { type: string; song?: PlaylistSong; cached?: boolean };
            if (event.type !== 'song' || !event.song) return;

            const songKey = `${event.song.source_type}:${event.song.song_id}:${event.song.spotify_uri ?? ''}`;
            const existingIndex = songIndexes.get(songKey);
            if (existingIndex === undefined) {
                songIndexes.set(songKey, songs.length);
                songs.push(event.song);
            } else {
                songs[existingIndex] = event.song;
            }

            cache.songs?.set(key, [...songs]);
            onUpdate?.([...songs]);
        };

        while (true) {
            const { done, value } = await reader.read();
            buffer += decoder.decode(value, { stream: !done });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            lines.forEach(consumeLine);
            if (done) break;
        }
        consumeLine(buffer);

        cache.songs?.set(key, songs);
        return songs;
    })()
        .finally(() => {
            cache.songRequests?.delete(key);
        });

    cache.songRequests?.set(key, request);
    return request;
}

function bucketByService(playlists: Playlist[]) {
    const buckets: Partial<Record<Service, Playlist[]>> = {};
    playlists.forEach(playlist => {
        const service = playlist.service as Service;
        if (!SERVICES.includes(service)) return;
        (buckets[service] ??= []).push(playlist);
    });
    return buckets;
}

function applySidebarResponse(cache: SidebarCache, data: SidebarPlaylistsResponse, markLive: boolean) {
    const playlists = Array.isArray(data.playlists) ? data.playlists : [];
    const buckets = bucketByService(playlists);

    SERVICES.forEach(service => {
        if (!buckets[service]) return;
        cache.byService[service] = buckets[service];
        if (markLive) cache.live.add(service);
    });

    if (data.frequent) cache.recentKeys = data.frequent.map(entry => `${entry.service}:${entry.playlist_id}`);

    remember(cache, playlists);
    flatten(cache);
}

function fetchSidebar(cache: SidebarCache) {
    const existing = cache.sidebarRequest;
    if (existing) return existing;

    const request = (api('/plugin/playlists/me/sidebar') as Promise<SidebarPlaylistsResponse>)
        .then(data => {
            applySidebarResponse(cache, data, true);
            persist(cache);
            return data;
        })
        .finally(() => {
            cache.sidebarRequest = undefined;
        });

    cache.sidebarRequest = request;
    return request;
}

function Sidebar() {
    const { t } = translations.useTranslation();
    const [accountKey, setAccountKey] = useState(() => getAccount() ?? 'no-account');
    const cache = useMemo(() => getCache(accountKey === 'no-account' ? null : accountKey), [accountKey]);
    const [, rerender] = useReducer((count: number) => count + 1, 0);
    const [playerState, setPlayerState] = useState(() => ({
        queueName: player.queueName,
        isPlaying: player.isPlaying,
    }));
    const [loadingPlaylistKey, setLoadingPlaylistKey] = useState<string | null>(null);

    useEffect(() => {
        const updateAccountKey = () => {
            setAccountKey(getAccount() ?? 'no-account');
        };

        window.addEventListener('account-switched', updateAccountKey);
        window.addEventListener('storage', updateAccountKey);
        const interval = window.setInterval(updateAccountKey, 1000);

        return () => {
            window.removeEventListener('account-switched', updateAccountKey);
            window.removeEventListener('storage', updateAccountKey);
            window.clearInterval(interval);
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        account(cache).then(() => { if (!cancelled) rerender(); }).catch(() => {});

        const hasAnything = SERVICES.some(service => (cache.byService[service]?.length ?? 0) > 0);
        if (!hasAnything) {
            (api('/plugin/playlists/me/sidebar/cached') as Promise<SidebarPlaylistsResponse>)
                .then(data => {
                    if (cancelled) return;
                    applySidebarResponse(cache, data, false);
                    rerender();
                })
                .catch(() => {});
        }

        fetchSidebar(cache)
            .then(() => { if (!cancelled) rerender(); })
            .catch(() => { if (!cancelled) rerender(); });

        return () => {
            cancelled = true;
        };
    }, [cache]);

    useEffect(() => player.subscribe(() => {
        setPlayerState({
            queueName: player.queueName,
            isPlaying: player.isPlaying,
        });
    }), []);

    const playlists = flatten(cache);
    const activeUser = cache.account ?? { id: '', name: '' };

    const rememberPlaylist = (playlist: Playlist) => {
        remember(cache, [playlist]);
        const key = playlistKey(playlist);
        cache.recentKeys = [key, ...cache.recentKeys.filter(existing => existing !== key)];
        persist(cache);
        rerender();
    };

    const openPlaylist = (playlist: Playlist) => {
        rememberPlaylist(playlist);
        navigate(`/playlist/${playlistRouteId(playlist)}`);
    };

    const registerPlay = (playlist: Playlist) => {
        rememberPlaylist(playlist);
        void api(`/plugin/playlists/me/${playlistRouteId(playlist)}`).catch(() => {});
    };

    const createPlaylist = () => {
        const response = api('/plugin/playlists/me/create', { method: 'POST' }) as Promise<CreatePlaylistResponse>;
        response
            .then(data => {
                if (!data.playlist) return;
                openPlaylist(data.playlist);
            })
            .catch(() => {});
    }

    const playPlaylist = async (playlist: Playlist) => {
        const key = playlistKey(playlist);
        if (playerState.queueName === playlistQueueName(playlist)) {
            player.togglePlay();
            return;
        }

        registerPlay(playlist);
        player.activateSource(playlist.service);
        setLoadingPlaylistKey(key);
        try {
            let started = false;
            let playback: Promise<void> | null = null;

            const startFromSongs = (songs: PlaylistSong[]) => {
                if (started || songs.length === 0) return;
                started = true;

                const [firstSong, ...remainingSongs] = songs;
                const firstItem = queueItem(firstSong, playlist);

                player.clearPriorityQueue();
                player.clearNextQueue();
                playback = player.playSong(firstItem.songId, firstItem.sourceType, firstItem.extra, true);
                player.setNextQueue(playlistQueueName(playlist), remainingSongs.map(song => queueItem(song, playlist)));
            };

            const songs = await getPlaylistSongs(cache, playlist, startFromSongs);
            if (!started) startFromSongs(songs);
            if (started) {
                player.setNextQueue(playlistQueueName(playlist), songs.slice(1).map(song => queueItem(song, playlist)));
            }
            await playback;
        } finally {
            setLoadingPlaylistKey(current => current === key ? null : current);
        }
    };

    const primePlaylistPlayback = (playlist: Playlist) => {
        player.activateSource(playlist.service);
    };

    const renderPlaylist = (playlist: Playlist) => {
        const key = playlistKey(playlist);
        const isActive = playerState.queueName === playlistQueueName(playlist);
        const isLoading = loadingPlaylistKey === key;

        return (
            <div
                key={key}
                className={`playlists-sidebar-playlist${isActive ? ' active' : ''}`}
                onClick={() => openPlaylist(playlist)}
            >
                <div className='playlists-sidebar-cover-wrap'>
                    <img src={playlist.is_liked_playlist ? liked : playlist.cover ?? unknownArt} alt={playlist.name} className='playlists-sidebar-playlist-cover' loading='lazy' decoding='async' />
                    <button
                        className='playlists-sidebar-play-button'
                        type='button'
                        aria-label={isActive && playerState.isPlaying ? `Pause ${playlist.name}` : `Play ${playlist.name}`}
                        disabled={isLoading}
                        onPointerDown={(event) => {
                            event.stopPropagation();
                            primePlaylistPlayback(playlist);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                primePlaylistPlayback(playlist);
                            }
                        }}
                        onClick={(event) => {
                            event.stopPropagation();
                            void playPlaylist(playlist);
                        }}
                    >
                        {isActive && playerState.isPlaying ? <Pause /> : <Play />}
                    </button>
                </div>
                <div className='playlist-info'>
                    <p className='playlists-sidebar-playlist-name'>{playlist.name}</p>
                    <p className='playlists-sidebar-playlist-created'>{playlist.created_by === activeUser.id ? t('sidebar.playlist.createdFor', { name: playlist.created_by_name }) : t('sidebar.playlist.createdBy', { name: playlist.created_by_name })}</p>
                </div>
            </div>
        );
    };

    const renderSkeletons = (count = 6) => Array.from({ length: count }, (_, index) => (
        <div key={`skeleton-${index}`} className='playlists-sidebar-playlist skeleton' aria-hidden='true'>
            <div className='playlists-sidebar-cover-wrap playlists-sidebar-skeleton-block' />
            <div className='playlist-info'>
                <p className='playlists-sidebar-skeleton-line' />
                <p className='playlists-sidebar-skeleton-line short' />
            </div>
        </div>
    ));

    const anyLive = SERVICES.some(service => cache.live.has(service));
    const showSkeletons = playlists.length === 0 && !anyLive;

    return (
        <div className='playlists-sidebar'>
            <div className='playlists-sidebar-header'>
                <div className='playlists-sidebar-header-search-new'>
                    <div className="playlists-sidebar-header-search">
                        <Search className='playlists-sidebar-header-search-icon' />
                        <input
                            type="search"
                            className='playlists-sidebar-header-search-input'
                            placeholder={t('sidebar.search.placeholder')}
                        />
                    </div>
                    <Tooltip id='new-playlist'/>
                    <button className='playlists-sidebar-header-new' onClick={createPlaylist} data-tooltip-id='new-playlist' data-tooltip-content={t('sidebar.new-playlist')}><Plus /></button>
                </div>
                <div className='playlists-sidebar-header-filters'>
                    <button className='playlists-sidebar-header-filter-item active'>All</button>
                    <button className='playlists-sidebar-header-filter-item'>Music</button>
                    <button className='playlists-sidebar-header-filter-item'>Podcasts</button>
                    <button className='playlists-sidebar-header-filter-item'>Audiobooks</button>
                </div>
            </div>
            <div className='playlists-sidebar-list'>
                {showSkeletons ? renderSkeletons() : playlists.map(renderPlaylist)}
            </div>
        </div>
    );
}

export default Sidebar;