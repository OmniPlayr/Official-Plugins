import { createElement } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { disconnect, getStatus } from './auth';
import SoundCloudSetup from './SoundCloudSetup';
import SoundCloudSourcePlugin from './SoundCloudSourcePlugin';
import translations from './translations';

import {
    player,
    registerPluginsMenuItem,
    closePopup,
    createPopup
} from '@omniplayr/plugins';

function mountSetupPopup() {
    const popupId = 'soundcloud-setup';
    createPopup({
        id: popupId,
        title: 'SoundCloud',
        subtitle: translations.t('setup.desc'),
        close_button: true,
        mobileFullscreen: true,
        group: 'soundcloud-setup',
        content: createElement(SoundCloudSetup, { onDone: () => closePopup(popupId) }),
    });
}

export function init() {
    player.registerPlugin('soundcloud', new SoundCloudSourcePlugin());

    getStatus().then(status => {
        if (status.connected) {
            registerPluginsMenuItem('soundcloud@built-in', {
                icon: LogOut,
                label: translations.t('setup.button.logout'),
                function: () => {
                    disconnect().then(() => location.reload());
                },
            });
        } else {
            registerPluginsMenuItem('soundcloud@built-in', {
                icon: LogIn,
                label: translations.t('setup.button.connect'),
                function: mountSetupPopup,
                needsInteraction: true,
            });
        }
    });
}
