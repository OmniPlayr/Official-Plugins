import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { getStatus, disconnect } from './auth';
import { loadSdk } from './sdk';
import { player, playSong } from '../../modules/player';
import SpotifySourcePlugin from './SpotifySourcePlugin';
import SpotifySetup from './SpotifySetup';
import { registerPluginsMenuItem } from '../../modules/plugins';
import { LogIn, LogOut } from 'lucide-react';

function mountSetupPopup() {
    if (document.getElementById('spotify-setup-root')) return;

    const container = document.createElement('div');
    container.id = 'spotify-setup-root';
    document.body.appendChild(container);

    const root = createRoot(container);

    function unmount() {
        root.unmount();
        container.remove();
    }

    root.render(createElement(SpotifySetup, { onDone: unmount }));
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
                needsInteraction: true
            });
        }
    });
}