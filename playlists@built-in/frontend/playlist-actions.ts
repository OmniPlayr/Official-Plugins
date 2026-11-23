import { api } from '@omniplayr/plugins';

type PlaylistReference = {
    id: string | number;
    service: string;
};

export function markPlaylistPlayed(playlist: PlaylistReference) {
    const playlistId = `${playlist.id}${playlist.service === 'local' ? '' : `:${playlist.service}`}`;
    window.dispatchEvent(new CustomEvent('playlist-played', { detail: playlist }));
    return api(`/plugin/playlists/me/${playlistId}/played`, { method: 'POST' });
}
