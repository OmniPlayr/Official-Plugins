import './styles/Home.css';
import translations from './translations';
import { useEffect, useMemo, useState } from 'react';
import liked from './assets/liked.svg';
import unknownArt from '../../assets/images/unknown-art.svg';
import { LoaderCircle, Pause, Play } from 'lucide-react';

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

export type HomeCache = {
    account?: UserAccount;
    accountRequest?: Promise<UserAccount>;
    playlists?: Playlist[];
    playlistsRequest?: Promise<Playlist[]>;
    songs?: Map<string, PlaylistSong[]>;
    songRequests?: Map<string, Promise<PlaylistSong[]>>;
};

const homeCache = new Map<string, HomeCache>();
const PERSISTENT_CACHE_PREFIX = 'omniplayr:playlist-home:';
const HOME_SERVICE_PLAYLIST_LIMIT = 11;
const HOME_PLAYLIST_SERVICES = 'local,spotify,soundcloud,youtube';
let prunedPersistentPlaylistCaches = false;

function prunePersistentPlaylistCaches() {
    if (prunedPersistentPlaylistCaches) return;
    prunedPersistentPlaylistCaches = true;
    for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index);
        if (key?.startsWith(PERSISTENT_CACHE_PREFIX)) {
            localStorage.removeItem(key);
            index -= 1;
        }
    }
}

function getCache(accountToken: string | null = getAccount()) {
    const key = accountToken ?? 'no-account';
    let cache = homeCache.get(key);

    if (!cache) {
        try {
            prunePersistentPlaylistCaches();
        } catch {
            
        }
        cache = {};
        cache.songs = new Map();
        cache.songRequests = new Map();
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

export async function getPlaylistSongs(cache: HomeCache, playlist: Playlist, onUpdate?: (songs: PlaylistSong[]) => void) {
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

function getPlaylists(
    userId: string | number,
    cache: HomeCache,
    onUpdate: (playlists: Playlist[]) => void,
    onUser: (user: UserAccount) => void,
) {
    if (cache.playlistsRequest) return cache.playlistsRequest;

    cache.playlistsRequest = (async () => {
        const playlists = new Map<string, Playlist>();
        const allCachedPlaylists = new Map<string, Playlist>(
            (cache.playlists ?? []).map((playlist) => [playlistKey(playlist), playlist]),
        );
        const cachedSpotifyOffset = Array.from(allCachedPlaylists.values())
            .filter((playlist) => playlist.service === 'spotify').length;
        const cachedYoutubeOffset = Array.from(allCachedPlaylists.values())
            .filter((playlist) => playlist.service === 'youtube').length;
        let receivedPlaylist = false;
        let fallbackLoaded = false;
        let fallbackTimer: ReturnType<typeof window.setTimeout> | null = null;

        const loadFallbackPlaylists = async () => {
            if (receivedPlaylist || fallbackLoaded) return;
            fallbackLoaded = true;

            try {
                const fallbackUser = cache.account ?? await account(cache);
                onUser(fallbackUser);
                const services = encodeURIComponent(HOME_PLAYLIST_SERVICES);
                const response = await api(
                    `/plugin/playlists/${fallbackUser.id}/cached?services=${services}&limit=${HOME_SERVICE_PLAYLIST_LIMIT}`,
                ) as Playlist[];
                response.forEach((playlist) => {
                    playlists.set(playlistKey(playlist), playlist);
                    allCachedPlaylists.set(playlistKey(playlist), playlist);
                });
                cache.playlists = Array.from(allCachedPlaylists.values());
                onUpdate(cache.playlists);
            } catch {

            }
        };

        try {
            const services = encodeURIComponent(HOME_PLAYLIST_SERVICES);
            fallbackTimer = window.setTimeout(() => {
                void loadFallbackPlaylists();
            }, 2500);
            const response = await api(
                `/plugin/playlists/${userId}/stream?services=${services}&limit=${HOME_SERVICE_PLAYLIST_LIMIT}&spotify_offset=${cachedSpotifyOffset}&youtube_offset=${cachedYoutubeOffset}`,
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
                if (!line.trim()) return;
                const event = JSON.parse(line) as { type: string; playlist?: Playlist; user?: UserAccount };
                if (event.type === 'start' && event.user) {
                    cache.account = event.user;
                    onUser(event.user);
                    return;
                }
                if (event.type === 'playlist' && event.playlist) {
                    receivedPlaylist = true;
                    playlists.set(playlistKey(event.playlist), event.playlist);
                    allCachedPlaylists.set(playlistKey(event.playlist), event.playlist);
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    onUpdate(cache.playlists);
                } else if (event.type === 'page') {
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    onUpdate(cache.playlists);
                } else if (event.type === 'done') {
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    onUpdate(cache.playlists);
                }
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
        } catch {
            await loadFallbackPlaylists();
        } finally {
            if (fallbackTimer !== null) {
                window.clearTimeout(fallbackTimer);
            }
        }

        cache.playlists = Array.from(allCachedPlaylists.values());
        return cache.playlists;
    })()
        .finally(() => {
            cache.playlistsRequest = undefined;
        });

    return cache.playlistsRequest;
}

function Home() {
    const { t } = translations.useTranslation();
    const [accountKey, setAccountKey] = useState(() => getAccount() ?? 'no-account');
    const cache = useMemo(() => getCache(accountKey === 'no-account' ? null : accountKey), [accountKey]);
    const [userAccount, setUserAccount] = useState<UserAccount | null>(cache.account ?? null);
    const [descriptionId] = useState(() => Math.floor(Math.random() * 6) + 1);
    const [playlists, setPlaylists] = useState<Playlist[] | null>(cache.playlists ?? null);
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
        const updatePlaylists = (nextPlaylists: Playlist[]) => {
            if (cancelled) return;
            setPlaylists(nextPlaylists);
        };
        const updateUser = (nextUser: UserAccount) => {
            if (cancelled) return;
            setUserAccount(nextUser);
        };

        setUserAccount(cache.account ?? null);
        setPlaylists(cache.playlists ?? null);
        account(cache).then(updateUser).catch(() => {});
        getPlaylists('me', cache, updatePlaylists, updateUser).then(updatePlaylists);

        return () => {
            cancelled = true;
        };
    }, [cache]);

    useEffect(() => {
        if (!userAccount || playlists?.length) return;

        let cancelled = false;
        const timer = window.setTimeout(() => {
            const services = encodeURIComponent(HOME_PLAYLIST_SERVICES);
            void api(
                `/plugin/playlists/${userAccount.id}/cached?services=${services}&limit=${HOME_SERVICE_PLAYLIST_LIMIT}`,
            )
                .then(response => {
                    if (cancelled || !Array.isArray(response) || response.length === 0) return;
                    cache.playlists = response as Playlist[];
                    setPlaylists(response as Playlist[]);
                })
                .catch(() => {});
        }, 1000);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [cache, playlists, userAccount]);

    useEffect(() => player.subscribe(() => {
        setPlayerState({
            queueName: player.queueName,
            isPlaying: player.isPlaying,
        });
    }), []);

    const spotifyPlaylistsAll = (playlists?.filter(p => p.service === 'spotify') ?? []);
    const spotifyPlaylists = (playlists?.filter(p => p.service === 'spotify') ?? []).slice(0, 10);

    const soundcloudPlaylists = (playlists?.filter(p => p.service === 'soundcloud') ?? []).slice(0, 10);
    const soundcloudPlaylistsAll = (playlists?.filter(p => p.service === 'soundcloud') ?? []);

    const youtubePlaylists = (playlists?.filter(p => p.service === 'youtube') ?? []).slice(0, 10);
    const youtubePlaylistsAll = (playlists?.filter(p => p.service === 'youtube') ?? []);

    const localPlaylists = (playlists?.filter(p => p.service === 'local') ?? []).slice(0, 10);
    const localPlaylistsAll = (playlists?.filter(p => p.service === 'local') ?? []);

    useEffect(() => {
        if (spotifyPlaylistsAll.length > 0) {
            player.activateSource('spotify');
        }
    }, [spotifyPlaylistsAll.length]);

    const activeUser = userAccount ?? { id: '', name: '' };
    const currentPlaylist = playlists?.find(playlist => playlistQueueName(playlist) === playerState.queueName) ?? null;

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
                className={`playlists-home-playlist${isActive ? ' active' : ''}`}
                onClick={() => navigate(`/playlist/${playlistRouteId(playlist)}`)}
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

    return (
        <div className='playlists-home'>
            <h1 className='playlists-home-title'>{t('home.title')}</h1>
            <p className='playlists-home-description'>{t('home.description.' + descriptionId, { name: activeUser.name })}</p>
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
                    <div className='playlist-group'>
                        <div className='playlist-group-header'>
                            <h2 className='playlist-group-title'>{t('home.playlists.title.local')}</h2>
                            {localPlaylistsAll.length > 10 && (
                                <button
                                    className='playlist-group-show-all'
                                    type='button'
                                    onClick={() => navigate('/playlists/local')}
                                >
                                    {t('home.playlists.show-all')}
                                </button>
                            )}
                        </div>
                        <div className='playlists-home-playlists'>
                            {localPlaylists.map(renderPlaylist)}
                        </div>
                    </div>
                    {spotifyPlaylists.length > 0 && (
                        <div className='playlist-group'>
                            <div className='playlist-group-header'>
                                <h2 className='playlist-group-title'>{t('home.playlists.title.spotify')}</h2>
                                {spotifyPlaylistsAll.length > 10 && (
                                    <button
                                        className='playlist-group-show-all'
                                        type='button'
                                        onClick={() => navigate('/playlists/spotify')}
                                    >
                                        {t('home.playlists.show-all')}
                                    </button>
                                )}
                            </div>
                            <div className='playlists-home-playlists'>
                                {spotifyPlaylists.map(renderPlaylist)}
                            </div>
                        </div>
                    )}
                    {soundcloudPlaylists.length > 0 && (
                        <div className='playlist-group'>
                            <div className='playlist-group-header'>
                                <h2 className='playlist-group-title'>{t('home.playlists.title.soundcloud')}</h2>
                                {soundcloudPlaylistsAll.length > 10 && (
                                    <button
                                        className='playlist-group-show-all'
                                        type='button'
                                        onClick={() => navigate('/playlists/soundcloud')}
                                    >
                                        {t('home.playlists.show-all')}
                                    </button>
                                )}
                            </div>
                            <div className='playlists-home-playlists'>
                                {soundcloudPlaylists.map(renderPlaylist)}
                            </div>
                        </div>
                    )}
                    {youtubePlaylists.length > 0 && (
                        <div className='playlist-group'>
                            <div className='playlist-group-header'>
                                <h2 className='playlist-group-title'>{t('home.playlists.title.youtube')}</h2>
                                {youtubePlaylistsAll.length > 10 && (
                                    <button
                                        className='playlist-group-show-all'
                                        type='button'
                                        onClick={() => navigate('/playlists/youtube')}
                                    >
                                        {t('home.playlists.show-all')}
                                    </button>
                                )}
                            </div>
                            <div className='playlists-home-playlists'>
                                {youtubePlaylists.map(renderPlaylist)}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default Home;
