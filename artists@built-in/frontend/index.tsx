import ArtistPage from './ArtistPage';
import { artistCache } from './artistCache';
import './main.css';
import AlbumPage from './AlbumPage';
import { albumCache } from './albumCache';
import { Disc3, KeyRound, UserRound } from 'lucide-react';
import ArtistsTokenSetup from './ArtistsTokenSetup';
import { getStatus } from './auth';
import translations, { PLUGIN_ID } from './translations';

import {
    modify,
    player,
    registerPlayerAction,
    api,
    navigate,
    createPopup,
    registerPluginsMenuItem,
    registerRoute
} from '@omniplayr/plugins';

function isTokenValid(): boolean {
    const access_expiry = localStorage.getItem('access_token_expires');
    const access_token = localStorage.getItem('access_token');
    if (access_expiry && access_token) {
        const expiryTime = new Date(access_expiry).getTime();
        return Date.now() < expiryTime;
    }
    return false;
}

let tokenSet = false;
let isAdmin = false;

function openTokenPopup() {
    createPopup({
        id: 'artists-token-popup',
        title: translations.t(tokenSet ? 'token.popup.title.edit' : 'token.popup.title.set'),
        subtitle: tokenSet
            ? translations.t('token.popup.subtitle.configured')
            : translations.t('token.popup.subtitle.missing'),
        close_button: true,
        content: <ArtistsTokenSetup tokenSet={tokenSet} isAdmin={isAdmin} onDone={() => location.reload()} />,
    });
}

export function init() {
    getStatus().then(status => {
        tokenSet = status.token_set;
        isAdmin = status.is_admin;
        registerPluginsMenuItem(PLUGIN_ID, {
            icon: KeyRound,
            label: tokenSet
                ? translations.t('token.menu.edit')
                : translations.t('token.menu.set'),
            function: openTokenPopup,
            needsInteraction: !tokenSet,
        });
    }).catch(() => {
        registerPluginsMenuItem(PLUGIN_ID, {
            icon: KeyRound,
            label: translations.t('token.menu.set'),
            function: openTokenPopup,
            needsInteraction: true,
        });
    });
}

registerRoute({ path: '/artist/:artist', component: () =>
    <ArtistPage />
});

registerRoute({ path: '/artist/:artist/:album', component: () =>
    <AlbumPage />
});

function getCurrentSong(): string | undefined {
    return player.currentMetadata?.title || player.currentMetadata?.filename || undefined;
}

function linkCredits(el: Element) {
    const text = el.textContent || ''
    const [artist, album] = text.split(' · ')
    const artists = artist?.split(' & ').filter(Boolean) || []
    el.textContent = ''
    artists.forEach((artistName, index) => {
        if (artistName && artistName !== 'undefined') {
            if (index > 0) {
                el.appendChild(document.createTextNode(' & '))
            }

            const artistSpan = document.createElement('span')
            artistSpan.className = 'artist-name'
            artistSpan.textContent = artistName
            let prefetched = false
            artistSpan.addEventListener('mouseenter', () => {
                if (prefetched) return
                prefetched = true
                const song = getCurrentSong()
                const params = new URLSearchParams({
                    ...(song ? { song } : {}),
                    ...(album ? { album } : {}),
                })
                const query = params.size ? `?${params}&no_cache=true` : ''
                api(`/plugin/artist/${encodeURIComponent(artistName)}${query}`).then(res => {
                    artistCache.set(artistName, res as any[])
                }).catch(() => {})
            })
            artistSpan.addEventListener('click', () => {
                const song = getCurrentSong()
                sessionStorage.setItem('artist-nav-context', JSON.stringify({
                    song,
                    album: album || undefined,
                }))
                navigate(`/artist/${encodeURIComponent(artistName)}`)
            })
            el.appendChild(artistSpan)
        }
    })
    if (album) {
        const separator = document.createTextNode(' · ')
        el.appendChild(separator)
        const albumSpan = document.createElement('span')
        albumSpan.className = 'album-name'
        albumSpan.textContent = album
        let prefetched = false
        albumSpan.addEventListener('mouseenter', () => {
            if (prefetched) return
            prefetched = true
            const song = getCurrentSong()
            const params = new URLSearchParams({
                ...(song ? { song } : {}),
                ...(artist ? { artist } : {}),
            })
            const query = params.size ? `?${params}&no_cache=true` : ''
            api(`/plugin/album/${encodeURIComponent(album)}${query}`).then(res => {
                albumCache.set(album + "_" + artist, res as any[])
            }).catch(() => {})
        })
        albumSpan.addEventListener('click', () => {
            const song = getCurrentSong()
            sessionStorage.setItem('artist-nav-context', JSON.stringify({
                song,
                album: album || undefined,
            }))
            navigate(`/artist/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`)
        })
        el.appendChild(albumSpan)
    }
}

modify(PLUGIN_ID, 'Player.player-track-artist', linkCredits);
modify(PLUGIN_ID, 'Infobar.ib-song-artist', linkCredits);

registerPlayerAction(PLUGIN_ID, {
    id: 'artist',
    icon: UserRound,
    label: () => translations.t('track.open_artist'),
    visible: ({ metadata }) => Boolean(metadata?.artist?.trim()),
    action: ({ metadata }) => {
        const artist = metadata?.artist?.split(' & ')[0]?.trim();
        if (!artist) return;
        sessionStorage.setItem('artist-nav-context', JSON.stringify({ song: getCurrentSong(), album: metadata?.album }));
        navigate(`/artist/${encodeURIComponent(artist)}`);
    },
});

registerPlayerAction(PLUGIN_ID, {
    id: 'album',
    icon: Disc3,
    label: () => translations.t('track.open_album'),
    visible: ({ metadata }) => Boolean(metadata?.artist?.trim() && metadata?.album?.trim()),
    action: ({ metadata }) => {
        const artist = metadata?.artist?.trim();
        const album = metadata?.album?.trim();
        if (!artist || !album) return;
        sessionStorage.setItem('artist-nav-context', JSON.stringify({ song: getCurrentSong(), album }));
        navigate(`/artist/${encodeURIComponent(artist)}/${encodeURIComponent(album)}`);
    },
});
