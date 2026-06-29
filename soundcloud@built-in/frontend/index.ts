import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { LogIn, LogOut } from 'lucide-react';
import { player } from '../../modules/player';
import { registerPluginsMenuItem } from '../../modules/plugins';
import { disconnect, getStatus } from './auth';
import SoundCloudSetup from './SoundCloudSetup';
import SoundCloudSourcePlugin from './SoundCloudSourcePlugin';

function mountSetupPopup() {
    if (document.getElementById('soundcloud-setup-root')) return;

    const container = document.createElement('div');
    container.id = 'soundcloud-setup-root';
    document.body.appendChild(container);

    const root = createRoot(container);

    function unmount() {
        root.unmount();
        container.remove();
    }

    root.render(createElement(SoundCloudSetup, { onDone: unmount }));
}

export function init() {
    getStatus().then(status => {
        if (status.connected) {
            player.registerPlugin('soundcloud', new SoundCloudSourcePlugin());
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
                label: 'Log In',
                function: mountSetupPopup,
                needsInteraction: true,
            });
        }
    });
}
