import { createElement } from 'react';
import { getStatus, disconnect } from './auth';
import { loadSdk } from './sdk';
import SpotifySourcePlugin from './SpotifySourcePlugin';
import SpotifySetup from './SpotifySetup';
import { LogIn, LogOut } from 'lucide-react';

import {
    player,
    registerPluginsMenuItem,
    createPopup,
    closePopup,
} from '@omniplayr/plugins';
import translations from './translations';

function mountSetupPopup() {
    const popupId = 'spotify-setup';

    createPopup({
        id: popupId,
        title: 'Spotify',
        subtitle: translations.t('setup.desc'),
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
                label: translations.t('setup.button.logout'),
                function: () => {
                    disconnect().then(() => location.reload());
                },
            });
        } else {
            registerPluginsMenuItem('spotify@built-in', {
                icon: LogIn,
                label: translations.t('setup.button.login'),
                function: mountSetupPopup,
                needsInteraction: true,
            });
        }
    });
}
