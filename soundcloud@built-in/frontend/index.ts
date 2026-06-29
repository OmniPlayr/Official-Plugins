import { createElement } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { player } from '../../modules/player';
import { registerPluginsMenuItem } from '../../modules/plugins';
import { closePopup, createPopup } from '../../modules/PopupContext';
import { disconnect, getStatus } from './auth';
import SoundCloudSetup from './SoundCloudSetup';
import SoundCloudSourcePlugin from './SoundCloudSourcePlugin';

function mountSetupPopup() {
    const popupId = 'soundcloud-setup';
    createPopup({
        id: popupId,
        title: 'SoundCloud',
        subtitle: 'Connect your SoundCloud account',
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
                label: 'Log Out',
                function: () => {
                    disconnect().then(() => location.reload());
                },
            });
        } else {
            registerPluginsMenuItem('soundcloud@built-in', {
                icon: LogIn,
                label: 'Connect Account',
                function: mountSetupPopup,
                needsInteraction: true,
            });
        }
    });
}
