import './styles/Home.css';
import translations from '.';
import api from '../../modules/api';
import { getAccount } from '../../modules/account';
import { useEffect, useState } from 'react';
import liked from './assets/liked.svg';
import { navigate } from '../../modules/navigate';
import unknownArt from '../../assets/images/unknown-art.svg';
import { player, type QueueItem } from '../../modules/player';
import { Pause, Play } from 'lucide-react';

type UserAccount = {
    id: string | number;
    name: string;
};

type Playlist = {
    id: string | number;
    service: string;
    name: string;
    cover?: string;
    is_liked_playlist: boolean;
    created_by: string | number | null;
    created_by_name: string;
};

type PlaylistSongMetadata = {
    title: string;
    artist: string;
    album: string;
};

type PlaylistSong = {
    source_type: string;
    song_id: string;
    spotify_uri: string | null;
    metadata: PlaylistSongMetadata;
};

type HomeCache = {
    account?: UserAccount;
    accountRequest?: Promise<UserAccount>;
    playlists?: Playlist[];
    playlistsRequest?: Promise<Playlist[]>;
    songs?: Map<string, PlaylistSong[]>;
    songRequests?: Map<string, Promise<PlaylistSong[]>>;
};

const homeCache = new Map<string, HomeCache>();

function persistentCacheKey(accountToken: string) {
    let hash = 2166136261;
    for (let index = 0; index < accountToken.length; index += 1) {
        hash ^= accountToken.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return `omniplayr:playlist-home:${(hash >>> 0).toString(16)}`;
}

function persistCache(cache: HomeCache) {
    const accountToken = getAccount();
    if (!accountToken) return;
    try {
        localStorage.setItem(persistentCacheKey(accountToken), JSON.stringify({
            account: cache.account,
            playlists: cache.playlists ?? [],
        }));
    } catch {
        // Persistent playlist cache is an optimization; playback still works without it.
    }
}

function getCache() {
    const key = getAccount() ?? 'no-account';
    let cache = homeCache.get(key);

    if (!cache) {
        try {
            const stored = key === 'no-account' ? null : localStorage.getItem(persistentCacheKey(key));
            const parsed = stored ? JSON.parse(stored) as Pick<HomeCache, 'account' | 'playlists'> : null;
            cache = parsed ?? {};
        } catch {
            cache = {};
        }
        cache.songs = new Map();
        cache.songRequests = new Map();
        homeCache.set(key, cache);
    }
    cache.songs ??= new Map();
    cache.songRequests ??= new Map();

    return cache;
}

function account(cache: HomeCache) {
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

function playlistKey(playlist: Playlist) {
    return `${playlist.service}:${playlist.id}`;
}

function playlistRouteId(playlist: Playlist) {
    return `${playlist.id}${playlist.service === 'local' ? '' : `:${playlist.service}`}`;
}

function playlistQueueName(playlist: Playlist) {
    return `playlist:${playlist.service}:${playlist.id}`;
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

async function getPlaylistSongs(cache: HomeCache, playlist: Playlist) {
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
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        const consumeLine = (line: string) => {
            if (!line.trim()) return;
            const event = JSON.parse(line) as { type: string; song?: PlaylistSong; cached?: boolean };
            if (event.type !== 'song' || !event.song || event.cached === true) return;
            songs.push(event.song);
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
    onUpdate: (playlists: Playlist[], revealedSpotifyCount?: number) => void,
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

        try {
            const response = await api(
                `/plugin/playlists/${userId}/stream?spotify_offset=${cachedSpotifyOffset}`,
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
                    persistCache(cache);
                    onUser(event.user);
                    return;
                }
                if (event.type === 'playlist' && event.playlist) {
                    playlists.set(playlistKey(event.playlist), event.playlist);
                    allCachedPlaylists.set(playlistKey(event.playlist), event.playlist);
                    if (event.playlist.service === 'local') {
                        cache.playlists = Array.from(allCachedPlaylists.values());
                        persistCache(cache);
                        onUpdate(
                            cache.playlists,
                            cache.playlists.filter((playlist) => playlist.service === 'spotify').length,
                        );
                    }
                } else if (event.type === 'page') {
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    persistCache(cache);
                    const revealed = cache.playlists.filter((playlist) => playlist.service === 'spotify').length;
                    onUpdate(cache.playlists, revealed);
                } else if (event.type === 'done') {
                    cache.playlists = Array.from(allCachedPlaylists.values());
                    persistCache(cache);
                    onUpdate(cache.playlists, cache.playlists.filter((playlist) => playlist.service === 'spotify').length);
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
            persistCache(cache);
            onUpdate(cache.playlists);
        }

        cache.playlists = Array.from(allCachedPlaylists.values());
        persistCache(cache);
        return cache.playlists;
    })()
        .finally(() => {
            cache.playlistsRequest = undefined;
        });

    return cache.playlistsRequest;
}

function Home() {
    const { t } = translations.useTranslation();
    const [cache] = useState(getCache);
    const [userAccount, setUserAccount] = useState<UserAccount | null>(cache.account ?? null);
    const [descriptionId] = useState(() => Math.floor(Math.random() * 6) + 1);
    const [playlists, setPlaylists] = useState<Playlist[] | null>(cache.playlists ?? null);
    const [playerState, setPlayerState] = useState(() => ({
        queueName: player.queueName,
        isPlaying: player.isPlaying,
    }));
    const [loadingPlaylistKey, setLoadingPlaylistKey] = useState<string | null>(null);
    const [visibleSpotifyCount, setVisibleSpotifyCount] = useState(
        () => cache.playlists?.filter((playlist) => playlist.service === 'spotify').length ?? 10,
    );

    useEffect(() => {
        const updatePlaylists = (nextPlaylists: Playlist[], revealedSpotifyCount?: number) => {
            setPlaylists(nextPlaylists);
            setVisibleSpotifyCount(
                revealedSpotifyCount
                ?? nextPlaylists.filter((playlist) => playlist.service === 'spotify').length,
            );
        };
        getPlaylists('me', cache, updatePlaylists, setUserAccount).then(updatePlaylists);
    }, [cache]);

    useEffect(() => player.subscribe(() => {
        setPlayerState({
            queueName: player.queueName,
            isPlaying: player.isPlaying,
        });
    }), []);

    const spotifyPlaylists = (playlists?.filter(p => p.service === 'spotify') ?? []).slice(0, visibleSpotifyCount);
    const activeUser = userAccount ?? { id: '', name: '' };
    const currentPlaylist = playlists?.find(playlist => playlistQueueName(playlist) === playerState.queueName) ?? null;

    const playPlaylist = async (playlist: Playlist) => {
        const key = playlistKey(playlist);
        if (playerState.queueName === playlistQueueName(playlist)) {
            player.togglePlay();
            return;
        }

        setLoadingPlaylistKey(key);
        try {
            const songs = await getPlaylistSongs(cache, playlist);
            if (songs.length === 0) return;

            const [firstSong, ...remainingSongs] = songs;
            const firstItem = queueItem(firstSong, playlist);

            player.clearPriorityQueue();
            player.clearNextQueue();
            const playback = player.playSong(firstItem.songId, firstItem.sourceType, firstItem.extra, true);
            player.setNextQueue(playlistQueueName(playlist), remainingSongs.map(song => queueItem(song, playlist)));
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
            {currentPlaylist && (
                <button
                    className='playlists-home-now-playing'
                    type='button'
                    onClick={() => navigate(`/playlist/${playlistRouteId(currentPlaylist)}`)}
                >
                    <span className='playlists-home-now-playing-label'>Playing from</span>
                    <span className='playlists-home-now-playing-name'>{currentPlaylist.name}</span>
                </button>
            )}
            <div className='playlist-group'>
                <h2 className='playlist-group-title'>{t('home.playlists.title.local')}</h2>
                <div className='playlists-home-playlists'>
                    {playlists
                        ?.filter(playlist => playlist.service === 'local')
                        .map(renderPlaylist)}
                </div>
            </div>
            {spotifyPlaylists.length > 0 && (
                <div className='playlist-group'>
                    <h2 className='playlist-group-title'>{t('home.playlists.title.spotify')}</h2>
                    <div className='playlists-home-playlists'>
                        {spotifyPlaylists.map(renderPlaylist)}
                    </div>
                </div>
            )}
        </div>
    );
}

export default Home;
