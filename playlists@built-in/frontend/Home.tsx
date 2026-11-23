import './styles/Home.css';
import { markPlaylistPlayed } from './playlist-actions';
import translations from './translations';
import { useEffect, useMemo, useReducer, useState } from 'react';
import liked from './assets/liked.svg';
import unknownArt from '../../assets/images/unknown-art.svg';
import { Pause, Play } from 'lucide-react';

import {
    api,
    getAccount,
    navigate,
    player,
    type QueueItem,
} from '@omniplayr/plugins';

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

export type FrequentPlaylist = {
    frequency: number;
    playlist_id: string | number;
    account_id: string | number;
    service?: string;
};

export type PlaylistsResponse = {
    playlists: Playlist[];
    frequent: FrequentPlaylist[];
};

export type PlaylistSongMetadata = {
    title: string;
    artist: string;
    album: string;
    album_art?: string | null;
};

type PlaylistQueueItem = QueueItem & {
    metadata?: PlaylistSongMetadata & { album_art: string | null };
};

export type PlaylistSong = {
    source_type: string;
    song_id: string;
    position?: number;
    spotify_uri: string | null;
    metadata: PlaylistSongMetadata;
};

const SERVICES = ['local', 'spotify', 'soundcloud', 'youtube'] as const;
type Service = typeof SERVICES[number];
type TimedResponse = PlaylistsResponse & { startedAt: number };

export type HomeCache = {
    key: string;
    account?: UserAccount;
    accountRequest?: Promise<UserAccount>;
    playlists?: Playlist[];
    byService: Partial<Record<Service, Playlist[]>>;
    serviceRequests: Partial<Record<Service, Promise<TimedResponse>>>;
    live: Set<Service>;
    known: Map<string, Playlist>;
    frequentPlaylists?: FrequentPlaylist[];
    lastBumpAt: number;
    songs?: Map<string, PlaylistSong[]>;
    songRequests?: Map<string, Promise<PlaylistSong[]>>;
};

const homeCache = new Map<string, HomeCache>();
const attemptedResolves = new Set<string>();
const LEGACY_CACHE_PREFIX = 'omniplayr:playlist-home:';
const PERSISTENT_CACHE_PREFIX = 'omniplayr:home:';
const HOME_SERVICE_PLAYLIST_LIMIT = 11;
const HOME_VISIBLE_LIMIT = 10;
const FREQUENT_LIMIT = 8;
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

function persist(cache: HomeCache) {
    try {
        localStorage.setItem(PERSISTENT_CACHE_PREFIX + cache.key, JSON.stringify({
            byService: Object.fromEntries(
                Object.entries(cache.byService).map(([service, list]) => [service, (list ?? []).map(stripHeavy)]),
            ),
            frequent: cache.frequentPlaylists ?? [],
            known: [...cache.known.values()].map(stripHeavy),
        }));
    } catch {
    }
}

function loadPersisted(cache: HomeCache) {
    try {
        const raw = localStorage.getItem(PERSISTENT_CACHE_PREFIX + cache.key);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.byService && typeof data.byService === 'object') cache.byService = data.byService;
        if (Array.isArray(data.frequent)) cache.frequentPlaylists = data.frequent;
        if (Array.isArray(data.known)) {
            data.known.forEach((playlist: Playlist) => cache.known.set(playlistKey(playlist), playlist));
        }
    } catch {
    }
}

function remember(cache: HomeCache, playlists: Playlist[]) {
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

function flatten(cache: HomeCache) {
    cache.playlists = SERVICES.flatMap(service => cache.byService[service] ?? []);
    return cache.playlists;
}

function getCache(accountToken: string | null = getAccount()) {
    const key = accountToken ?? 'no-account';
    let cache = homeCache.get(key);

    if (!cache) {
        pruneLegacyCaches();
        cache = {
            key,
            byService: {},
            serviceRequests: {},
            live: new Set(),
            known: new Map(),
            lastBumpAt: 0,
            songs: new Map(),
            songRequests: new Map(),
        };
        loadPersisted(cache);
        flatten(cache);
        homeCache.set(key, cache);
    }
    cache.songs ??= new Map();
    cache.songRequests ??= new Map();

    return cache;
}

export function account(cache: HomeCache) {
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

export function queueItem(song: PlaylistSong, playlist: Playlist): PlaylistQueueItem {
    const albumArt = song.metadata.album_art ?? null;

    return {
        songId: song.song_id,
        sourceType: song.source_type,
        extra: {
            artist: song.metadata.artist,
            title: song.metadata.title,
            album: song.metadata.album,
            albumArt,
            album_art: albumArt,
            spotifyUri: song.spotify_uri,
            playlistService: playlist.service,
            playlistId: playlist.id,
            playlistName: playlist.name,
            playlistPosition: song.position,
        },
        metadata: {
            ...song.metadata,
            album_art: albumArt,
        },
    };
}

export async function getPlaylistSongs(cache: HomeCache, playlist: Playlist, onUpdate?: (songs: PlaylistSong[]) => void) {
    const key = playlistKey(playlist);
    if (cache.songRequests?.has(key)) return cache.songRequests.get(key)!;
    if (cache.songs?.has(key)) return cache.songs.get(key)!;

    const request = (async () => {
        const response = await api(
            `/plugin/playlists/me/${playlistRouteId(playlist)}/stream?fast=1`,
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
        const imageAssets = new Map<string, string>();
        let pendingSongChanges = 0;
        let hasPublishedFirstSong = false;

        const publishSongs = (force = false) => {
            if (!onUpdate || pendingSongChanges === 0) return;
            if (!force && !hasPublishedFirstSong && songs.length > 0) {
                hasPublishedFirstSong = true;
            } else if (!force && pendingSongChanges < 10) {
                return;
            }
            pendingSongChanges = 0;
            onUpdate([...songs]);
        };

        const consumeLine = (line: string) => {
            if (!line.trim()) return;
            const event = JSON.parse(line) as {
                type: string;
                song?: Omit<PlaylistSong, 'metadata'> & {
                    metadata: Omit<PlaylistSongMetadata, 'album_art'> & { album_art?: unknown };
                };
                images?: { id: string; asset: string }[];
                cached?: boolean;
            };
            event.images?.forEach(({ id, asset }) => imageAssets.set(id, asset));
            if (event.type !== 'song' || !event.song) return;

            const albumArt = event.song.metadata.album_art;
            const song: PlaylistSong = {
                ...event.song,
                metadata: {
                    ...event.song.metadata,
                    album_art: typeof albumArt === 'string'
                        ? albumArt
                        : albumArt && typeof albumArt === 'object' && 'asset_id' in albumArt
                            ? imageAssets.get(String(albumArt.asset_id)) ?? null
                            : null,
                },
            };
            const songKey = `${song.source_type}:${song.song_id}:${song.spotify_uri ?? ''}`;
            const existingIndex = songIndexes.get(songKey);
            if (existingIndex === undefined) {
                songIndexes.set(songKey, songs.length);
                songs.push(song);
            } else {
                songs[existingIndex] = song;
            }

            pendingSongChanges += 1;
            publishSongs();
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
        publishSongs(true);

        cache.songs?.set(key, songs);
        return songs;
    })()
        .finally(() => {
            cache.songRequests?.delete(key);
        });

    cache.songRequests?.set(key, request);
    return request;
}

function fetchService(cache: HomeCache, service: Service) {
    const existing = cache.serviceRequests[service];
    if (existing) return existing;

    const startedAt = Date.now();
    const request = (api(
        `/plugin/playlists/me?services=${service}&limit=${HOME_SERVICE_PLAYLIST_LIMIT}`,
    ) as Promise<PlaylistsResponse>)
        .then(data => {
            const playlists = Array.isArray(data.playlists) ? data.playlists : [];
            cache.byService[service] = playlists;
            cache.live.add(service);
            remember(cache, playlists);
            flatten(cache);
            applyFrequent(cache, data.frequent, startedAt);
            persist(cache);
            return { ...data, startedAt };
        })
        .finally(() => {
            delete cache.serviceRequests[service];
        });

    cache.serviceRequests[service] = request;
    return request;
}

function applyFrequent(cache: HomeCache, frequent: FrequentPlaylist[] | undefined, startedAt: number) {
    if (!Array.isArray(frequent) || startedAt <= cache.lastBumpAt) return;
    cache.frequentPlaylists = frequent;
}

function frequentMatches(frequent: FrequentPlaylist, playlist: Playlist) {
    if (String(frequent.playlist_id) !== String(playlist.id)) return false;
    return !frequent.service || frequent.service === playlist.service;
}

function Home() {
    const { t } = translations.useTranslation();
    const [accountKey, setAccountKey] = useState(() => getAccount() ?? 'no-account');
    const cache = useMemo(() => getCache(accountKey === 'no-account' ? null : accountKey), [accountKey]);
    const [version, rerender] = useReducer((count: number) => count + 1, 0);
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

    const refreshFrequent = () => {
        (api(`/plugin/playlists/me?services=local&limit=1`) as Promise<PlaylistsResponse>)
            .then(data => {
                if (!Array.isArray(data.frequent)) return;
                cache.frequentPlaylists = data.frequent;
                persist(cache);
                rerender();
            })
            .catch(() => {});
    };

    useEffect(() => {
        let cancelled = false;

        account(cache).then(() => { if (!cancelled) rerender(); }).catch(() => {});

        const hasAnything = SERVICES.some(service => (cache.byService[service]?.length ?? 0) > 0);
        if (!hasAnything) {
            const startedAt = Date.now();
            const services = encodeURIComponent(SERVICES.join(','));
            (api(`/plugin/playlists/me/cached?services=${services}&limit=${HOME_SERVICE_PLAYLIST_LIMIT}`) as Promise<PlaylistsResponse>)
                .then(data => {
                    if (cancelled || !Array.isArray(data?.playlists)) return;
                    SERVICES.forEach(service => {
                        if (cache.live.has(service)) return;
                        const list = data.playlists.filter(playlist => playlist.service === service);
                        if (list.length === 0) return;
                        cache.byService[service] = list;
                        remember(cache, list);
                    });
                    flatten(cache);
                    if (!cache.frequentPlaylists?.length) applyFrequent(cache, data.frequent, startedAt);
                    rerender();
                })
                .catch(() => {});
        }

        SERVICES.forEach(service => {
            fetchService(cache, service)
                .then(() => { if (!cancelled) rerender(); })
                .catch(() => { if (!cancelled) rerender(); });
        });

        const refreshOnFocus = () => {
            if (document.visibilityState === 'visible') refreshFrequent();
        };
        window.addEventListener('focus', refreshOnFocus);
        document.addEventListener('visibilitychange', refreshOnFocus);

        return () => {
            cancelled = true;
            window.removeEventListener('focus', refreshOnFocus);
            document.removeEventListener('visibilitychange', refreshOnFocus);
        };
    }, [cache]);

    useEffect(() => player.subscribe(() => {
        setPlayerState({
            queueName: player.queueName,
            isPlaying: player.isPlaying,
        });
    }), []);

    const playlists = flatten(cache);
    const forService = (service: Service) => cache.byService[service] ?? [];

    const spotifyPlaylistsAll = forService('spotify');
    const soundcloudPlaylistsAll = forService('soundcloud');
    const youtubePlaylistsAll = forService('youtube');
    const localPlaylistsAll = forService('local');

    const spotifyPlaylists = spotifyPlaylistsAll.slice(0, HOME_VISIBLE_LIMIT);
    const soundcloudPlaylists = soundcloudPlaylistsAll.slice(0, HOME_VISIBLE_LIMIT);
    const youtubePlaylists = youtubePlaylistsAll.slice(0, HOME_VISIBLE_LIMIT);
    const localPlaylists = localPlaylistsAll.slice(0, HOME_VISIBLE_LIMIT);
    const localLoading = !cache.live.has('local') && localPlaylistsAll.length === 0;

    const lookup = useMemo(() => {
        const map = new Map<string, Playlist>();
        cache.known.forEach((playlist, key) => map.set(key, playlist));
        playlists.forEach(playlist => map.set(playlistKey(playlist), playlist));
        return map;
    }, [cache, version]);

    const findPlaylist = (frequent: FrequentPlaylist) => {
        if (frequent.service) return lookup.get(`${frequent.service}:${frequent.playlist_id}`);
        for (const playlist of lookup.values()) {
            if (frequentMatches(frequent, playlist)) return playlist;
        }
        return undefined;
    };

    const frequentPlaylists = cache.frequentPlaylists ?? [];
    const resolvedFrequentPlaylists = (() => {
        const seen = new Set<string>();
        const result: Playlist[] = [];
        [...frequentPlaylists]
            .sort((a, b) => a.frequency - b.frequency)
            .forEach(frequent => {
                const playlist = findPlaylist(frequent);
                if (!playlist) return;
                const key = playlistKey(playlist);
                if (seen.has(key)) return;
                seen.add(key);
                result.push(playlist);
            });
        return result.slice(0, FREQUENT_LIMIT);
    })();

    useEffect(() => {
        const liveDone = SERVICES.every(service => cache.live.has(service) || cache.serviceRequests[service] === undefined);
        if (!liveDone) return;

        const missing = new Map<string, Set<string>>();
        (cache.frequentPlaylists ?? []).forEach(frequent => {
            if (!frequent.service || lookup.has(`${frequent.service}:${frequent.playlist_id}`)) return;
            if (!missing.has(frequent.service)) missing.set(frequent.service, new Set());
            missing.get(frequent.service)!.add(String(frequent.playlist_id));
        });

        let cancelled = false;
        missing.forEach((ids, service) => {
            if (!(SERVICES as readonly string[]).includes(service)) return;
            const attemptKey = `${cache.key}:${service}:${[...ids].sort().join(',')}`;
            if (attemptedResolves.has(attemptKey)) return;
            attemptedResolves.add(attemptKey);

            void (async () => {
                const remaining = new Set(ids);
                const found: Playlist[] = [];
                for (let offset = 0; offset < 200 && remaining.size > 0; offset += 50) {
                    const data = await api(
                        `/plugin/playlists/me?services=${service}&limit=50&offset=${offset}`,
                    ) as PlaylistsResponse;
                    const page = Array.isArray(data.playlists) ? data.playlists : [];
                    page.forEach(playlist => {
                        if (remaining.delete(String(playlist.id))) found.push(playlist);
                    });
                    if (page.length < 50) break;
                }
                if (found.length > 0) {
                    remember(cache, found);
                    persist(cache);
                    if (!cancelled) rerender();
                }
            })().catch(() => {});
        });

        return () => {
            cancelled = true;
        };
    }, [cache, lookup, version]);

    useEffect(() => {
        if (spotifyPlaylistsAll.length > 0) {
            player.activateSource('spotify');
        }
    }, [spotifyPlaylistsAll.length]);

    const activeUser = cache.account ?? { id: '', name: '' };
    const currentPlaylist = playlists.find(playlist => playlistQueueName(playlist) === playerState.queueName) ?? null;

    const bumpFrequent = (playlist: Playlist) => {
        cache.lastBumpAt = Date.now();
        remember(cache, [playlist]);
        const rest = (cache.frequentPlaylists ?? []).filter(frequent => !frequentMatches(frequent, playlist));
        cache.frequentPlaylists = [
            { frequency: 1, playlist_id: playlist.id, service: playlist.service, account_id: activeUser.id },
            ...rest,
        ]
            .slice(0, FREQUENT_LIMIT)
            .map((frequent, index) => ({ ...frequent, frequency: index + 1 }));
        persist(cache);
        rerender();
    };

    const openPlaylist = (playlist: Playlist) => {
        navigate(`/playlist/${playlistRouteId(playlist)}`);
    };

    const registerPlay = (playlist: Playlist) => {
        void markPlaylistPlayed(playlist)
            .then(() => refreshFrequent())
            .catch(() => {});
    };

    useEffect(() => {
        const handlePlaylistPlayed = (event: Event) => {
            const playlist = (event as CustomEvent<Playlist>).detail;
            if (playlist) bumpFrequent(playlist);
        };

        window.addEventListener('playlist-played', handlePlaylistPlayed);
        return () => window.removeEventListener('playlist-played', handlePlaylistPlayed);
    }, [cache, activeUser.id]);

    const playPlaylist = async (playlist: Playlist) => {
        const key = playlistKey(playlist);
        if (playerState.queueName === playlistQueueName(playlist)) {
            player.togglePlay();
            return;
        }

        player.activateSource(playlist.service);
        setLoadingPlaylistKey(key);
        try {
            let started = false;
            let playback: Promise<void> | null = null;

            const startFromSongs = (songs: PlaylistSong[]) => {
                if (songs.length === 0) return;

                if (!started) {
                    started = true;
                    registerPlay(playlist);
                    const firstItem = queueItem(songs[0], playlist);
                    player.clearPriorityQueue();
                    player.clearNextQueue();
                    playback = player.playSong(firstItem.songId, firstItem.sourceType, firstItem.extra, true);
                    setLoadingPlaylistKey(current => current === key ? null : current);
                }

                player.setNextQueue(playlistQueueName(playlist), songs.slice(1).map(song => queueItem(song, playlist)));
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
                className={`playlists-home-playlist${isActive ? ' active' : ''}`}
                onClick={() => openPlaylist(playlist)}
            >
                <div className='playlists-home-cover-wrap'>
                    <img src={playlist.is_liked_playlist ? liked : playlist.cover ?? unknownArt} alt={playlist.name} className='playlists-home-playlist-cover' loading='lazy' decoding='async' />
                    <button
                        className='playlists-home-play-button'
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
                    <p className='playlists-home-playlist-name'>{playlist.name}</p>
                    <p className='playlists-home-playlist-created'>{playlist.created_by === activeUser.id ? t('home.playlist.createdFor', { name: playlist.created_by_name }) : t('home.playlist.createdBy', { name: playlist.created_by_name })}</p>
                </div>
            </div>
        );
    };

    const renderSkeletons = (count = 6) => Array.from({ length: count }, (_, index) => (
        <div key={`skeleton-${index}`} className='playlists-home-playlist skeleton' aria-hidden='true'>
            <div className='playlists-home-cover-wrap skeleton-block' />
            <div className='playlist-info'>
                <p className='skeleton-line' />
                <p className='skeleton-line short' />
            </div>
        </div>
    ));

    const renderGroup = (
        service: Service,
        visible: Playlist[],
        all: Playlist[],
        title: string,
        loading = false,
    ) => (
        <div className='playlist-group'>
            <div className='playlist-group-header'>
                <h2 className='playlist-group-title'>{title}</h2>
                {all.length > HOME_VISIBLE_LIMIT && (
                    <button
                        className='playlist-group-show-all'
                        type='button'
                        onClick={() => navigate(`/playlists/${service}`)}
                    >
                        {t('home.playlists.show-all')}
                    </button>
                )}
            </div>
            <div className='playlists-home-playlists'>
                {loading ? renderSkeletons() : visible.map(renderPlaylist)}
            </div>
        </div>
    );

    return (
        <div className='playlists-home'>
            <div className='playlists-home-header'>
                <div className='playlists-home-header-filters'>
                    <button className='playlists-home-header-filter-item active'>All</button>
                    <button className='playlists-home-header-filter-item'>Music</button>
                    <button className='playlists-home-header-filter-item'>Podcasts</button>
                    <button className='playlists-home-header-filter-item'>Audiobooks</button>
                </div>
            </div>
            <div className='playlists-home-frequent'>
                {resolvedFrequentPlaylists.length > 0 && (
                    <div className='playlist-group'>
                        <div className='playlists-home-playlists frequent'>
                            {resolvedFrequentPlaylists.map(renderPlaylist)}
                        </div>
                    </div>
                )}
            </div>
            <div className='playlist-home-container'>
                <div className='playlist-home-container-widgets-small'>
                    {currentPlaylist && (
                        <button
                            className='playlists-home-now-playing'
                            type='button'
                            onClick={() => navigate(`/playlist/${playlistRouteId(currentPlaylist)}`)}
                        >
                            <span className='playlists-home-now-playing-label'>{t('home.playing-from')}</span>
                            <span className='playlists-home-now-playing-name'>{currentPlaylist.name}</span>
                        </button>
                    )}
                </div>
                <div className='playlist-home-container-widgets-large'>
                    {renderGroup('local', localPlaylists, localPlaylistsAll, t('home.playlists.title.local'), localLoading)}
                    {spotifyPlaylists.length > 0 && renderGroup('spotify', spotifyPlaylists, spotifyPlaylistsAll, t('home.playlists.title.spotify'))}
                    {soundcloudPlaylists.length > 0 && renderGroup('soundcloud', soundcloudPlaylists, soundcloudPlaylistsAll, t('home.playlists.title.soundcloud'))}
                    {youtubePlaylists.length > 0 && renderGroup('youtube', youtubePlaylists, youtubePlaylistsAll, t('home.playlists.title.youtube'))}
                </div>
            </div>
        </div>
    );
}

export default Home;