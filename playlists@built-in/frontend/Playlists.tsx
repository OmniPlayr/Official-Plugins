import { api, getAccount, navigate, player } from "@omniplayr/plugins";
import { useParams } from "react-router-dom"
import './styles/Playlists.css';
import translations from "./translations";
import { useEffect, useState } from "react";
import liked from './assets/liked.svg';
import unknownArt from '../../assets/images/unknown-art.svg';
import { Pause, Play } from 'lucide-react';
import {
    type UserAccount,
    type Playlist,
    type PlaylistSong,
    type HomeCache,
    queueItem,
    getPlaylistSongs,
    playlistKey,
    playlistRouteId,
    playlistQueueName,
    account
} from './Home';

const homeCache = new Map<string, HomeCache>();
const PERSISTENT_CACHE_PREFIX = 'omniplayr:playlist-home:';
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

function getCache() {
    const key = getAccount() ?? 'no-account';
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

function getPlaylists(
    userId: string | number,
    cache: HomeCache,
    onUpdate: (playlists: Playlist[], revealedCount?: number) => void,
    onUser: (user: UserAccount) => void,
    service: string
) {
    if (cache.playlistsRequest) return cache.playlistsRequest;

    cache.playlistsRequest = (async () => {
        const playlists = new Map<string, Playlist>();
        const allCachedPlaylists = new Map<string, Playlist>(
            (cache.playlists ?? []).map((playlist) => [playlistKey(playlist), playlist]),
        );

        const cachedOffset = Array.from(allCachedPlaylists.values()).length;

        try {
            const response = await api(
                `/plugin/playlists/${userId}/stream?services=${service}&offset=${cachedOffset}`,
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
                    playlists.set(playlistKey(event.playlist), event.playlist);
                    allCachedPlaylists.set(playlistKey(event.playlist), event.playlist);
                    if (event.playlist.service === 'local') {
                        cache.playlists = Array.from(allCachedPlaylists.values());
                        onUpdate(
                            cache.playlists,
                            cache.playlists.filter((playlist) => playlist.service === service).length,
                        );
                    }
                } else if (event.type === 'page') {
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    const revealed = cache.playlists.filter((playlist) => playlist.service === service).length;
                    onUpdate(cache.playlists, revealed);
                } else if (event.type === 'done') {
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    onUpdate(cache.playlists, cache.playlists.filter((playlist) => playlist.service === service).length);
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
            const fallbackUser = await account(cache);
            onUser(fallbackUser);
            const response = await api(`/plugin/playlists/${fallbackUser.id}`) as Playlist[];
            response.forEach((playlist) => {
                playlists.set(playlistKey(playlist), playlist);
                allCachedPlaylists.set(playlistKey(playlist), playlist);
            });
            cache.playlists = Array.from(allCachedPlaylists.values());
            onUpdate(cache.playlists);
        }

        cache.playlists = Array.from(allCachedPlaylists.values());
        return cache.playlists;
    })()
        .finally(() => {
            cache.playlistsRequest = undefined;
        });

    return cache.playlistsRequest;
}

function Playlists() {
    const { service } = useParams() as { service: string };
    const { t } = translations.useTranslation();
    const [loadingPlaylistKey, setLoadingPlaylistKey] = useState<string | null>(null);
    const [cache] = useState(getCache);
    const [playlists, setPlaylists] = useState<Playlist[] | null>(cache.playlists ?? null);
    const [playerState, setPlayerState] = useState(() => ({
        queueName: player.queueName,
        isPlaying: player.isPlaying,
    }));
    const [userAccount, setUserAccount] = useState<UserAccount | null>(cache.account ?? null);

    const [visibleCount, setVisibleCount] = useState(
        () => cache.playlists?.filter((playlist) => playlist.service === service).length ?? 10,
    );
    
    if (!service) navigate('/');

    const activeUser = userAccount ?? { id: '', name: '' };
    
    useEffect(() => {
        const updatePlaylists = (nextPlaylists: Playlist[], revealedCount?: number) => {
            setPlaylists(nextPlaylists);
            setVisibleCount(
                revealedCount
                ?? nextPlaylists.filter((playlist) => playlist.service === service).length,
            );
        };
        getPlaylists('me', cache, updatePlaylists, setUserAccount, service).then(updatePlaylists);
    }, [cache]);

    useEffect(() => player.subscribe(() => {
        setPlayerState({
            queueName: player.queueName,
            isPlaying: player.isPlaying,
        });
    }), []);

    useEffect(() => {
        if (service === 'spotify' && playlists?.some(playlist => playlist.service === 'spotify')) {
            player.activateSource('spotify');
        }
    }, [playlists, service]);

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
                            player.activateSource(playlist.service);
                        }}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                                player.activateSource(playlist.service);
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

    const playlistsToRender = playlists?.filter((playlist) => playlist.service === service).slice(0, visibleCount);
    if (!playlistsToRender) return null;

    return (
        <div className='playlists-all'>
            <h1 className='playlists-all-title'>{t('home.playlists.title.' + service)}</h1>
            <div className='playlists-all-playlists'>
                {playlistsToRender?.map((playlist) => renderPlaylist(playlist))}
            </div>
        </div>
    )
}

export default Playlists
