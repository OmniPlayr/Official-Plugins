import { createElement } from 'react';
import { getStatus, disconnect } from './auth';
import { loadSdk } from './sdk';
import { player } from '../../modules/player';
import SpotifySourcePlugin from './SpotifySourcePlugin';
import SpotifySetup from './SpotifySetup';
import { registerPluginsMenuItem } from '../../modules/plugins';
import { closePopup, createPopup } from '../../modules/PopupContext';
import { LogIn, LogOut } from 'lucide-react';

function mountSetupPopup() {
    const popupId = 'spotify-setup';

    createPopup({
        id: popupId,
        title: 'Spotify',
        subtitle: 'Connect your Spotify account',
        close_button: true,
        mobileFullscreen: true,
        group: 'spotify-setup',
        content: createElement(SpotifySetup, { onDone: () => closePopup(popupId) }),
    });
}


export function init() {
    getStatus().then(s => {
        if (s.connected) {
            loadSdk();
            player.registerPlugin('spotify', new SpotifySourcePlugin());
            registerPluginsMenuItem('spotify@built-in', {
                icon: LogOut,
                label: 'Log Out',
                function: () => {
                    disconnect().then(() => location.reload());
                },
            });
        } else {
            registerPluginsMenuItem('spotify@built-in', {
                icon: LogIn,
                label: 'Log In',
                function: mountSetupPopup,
                needsInteraction: true,
            });
        }
    });
}
