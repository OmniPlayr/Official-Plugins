import { registerPluginsMenuItem, registerRoute } from '../../modules/plugins';
import ArtistPage from './ArtistPage';
import { modify } from '../../modules/plugins';
import { artistCache } from './artistCache';
import './main.css';
import api from '../../modules/api';
import { navigate } from '../../modules/navigate';
import { getAccount } from '../../modules/account';
import AccountSelect from '../../AccountSelect';
import { Navigate } from 'react-router-dom';
import AlbumPage from './AlbumPage';
import { albumCache } from './albumCache';
import { createPopup } from '../../modules/PopupContext';
import i18n from '../../i18n';
import { KeyRound } from 'lucide-react';
import ArtistsTokenSetup from './ArtistsTokenSetup';
import { getStatus } from './auth';

const isMobile = window.innerWidth < 768
const selector = isMobile ? 'Player-Fullscreen.player-fullscreen-artist' : 'Player.player-track-artist'

function isTokenValid(): boolean {
    const access_expiry = localStorage.getItem('access_token_expires');
    const access_token = localStorage.getItem('access_token');
    if (access_expiry && access_token) {
        const expiryTime = new Date(access_expiry).getTime();
        return Date.now() < expiryTime;
    }
    return false;
}

const account_id = getAccount() || null;
let tokenSet = false;
let isAdmin = false;

function openTokenPopup() {
    createPopup({
        id: 'artists-token-popup',
        title: i18n.t(tokenSet ? 'token.popup.title.edit' : 'token.popup.title.set', { ns: 'artists@built-in' }),
        subtitle: tokenSet
            ? i18n.t('token.popup.subtitle.configured', { ns: 'artists@built-in' })
            : i18n.t('token.popup.subtitle.missing', { ns: 'artists@built-in' }),
        close_button: true,
        content: <ArtistsTokenSetup tokenSet={tokenSet} isAdmin={isAdmin} onDone={() => location.reload()} />,
    });
}

export function init() {
    getStatus().then(status => {
        tokenSet = status.token_set;
        isAdmin = status.is_admin;
        registerPluginsMenuItem('artists@built-in', {
            icon: KeyRound,
            label: tokenSet
                ? i18n.t('token.menu.edit', { ns: 'artists@built-in' })
                : i18n.t('token.menu.set', { ns: 'artists@built-in' }),
            function: openTokenPopup,
            needsInteraction: !tokenSet,
        });
    }).catch(() => {
        registerPluginsMenuItem('artists@built-in', {
            icon: KeyRound,
            label: i18n.t('token.menu.set', { ns: 'artists@built-in' }),
            function: openTokenPopup,
            needsInteraction: true,
        });
    });
}

registerRoute({ path: '/artist/:artist', component: () =>
    isTokenValid()
        ? account_id
        ? <ArtistPage />
        : <AccountSelect onAccountSelected={() => {}}/>
        : <Navigate to="/login" />
});

registerRoute({ path: '/artist/:artist/:album', component: () =>
    isTokenValid()
        ? account_id
        ? <AlbumPage />
        : <AccountSelect onAccountSelected={() => {}}/>
        : <Navigate to="/login" />
});

function getCurrentSong(): string | undefined {
    return document.querySelector('.player-track-title')?.textContent?.trim() || undefined;
}

modify('artists@built-in', selector, async el => {
    const text = el.textContent || ''
    const [artist, album] = text.split(' · ')
    el.textContent = ''
    if (artist && artist !== 'undefined') {
        const artistSpan = document.createElement('span')
        artistSpan.className = 'artist-name'
        artistSpan.textContent = artist
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
            api(`/plugin/artist/${encodeURIComponent(artist)}${query}`).then(res => {
                artistCache.set(artist, res as any[])
            }).catch(() => {})
        })
        artistSpan.addEventListener('click', () => {
            const song = getCurrentSong()
            sessionStorage.setItem('artist-nav-context', JSON.stringify({
                song,
                album: album || undefined,
            }))
            navigate(`/artist/${encodeURIComponent(artist)}`)
        })
        el.appendChild(artistSpan)
    }
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
            api(`/plugin/album/${encodeURIComponent(artist)}${query}`).then(res => {
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
})
