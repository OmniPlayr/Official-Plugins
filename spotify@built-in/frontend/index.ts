import { createElement } from 'react';
import { getStatus, disconnect } from './auth';
import { loadSdk } from './sdk';
import SpotifySourcePlugin from './SpotifySourcePlugin';
import SpotifySetup from './SpotifySetup';
import { LogIn, LogOut } from 'lucide-react';

import {
    player,
    getAccount,
    registerPluginsMenuItem,
    createPopup,
    closePopup,
} from '@omniplayr/plugins';
import translations from './translations';

let sdkWarmupListenersInstalled = false;
let sdkWarmupTimer: ReturnType<typeof window.setTimeout> | null = null;
let sdkWarmupAttempt = 0;

function queueSdkWarmup(delayMs = 0) {
    if (sdkWarmupTimer) {
        window.clearTimeout(sdkWarmupTimer);
    }

    sdkWarmupTimer = window.setTimeout(() => {
        sdkWarmupTimer = null;

        if (!getAccount()) {
            if (sdkWarmupAttempt < 10) {
                sdkWarmupAttempt += 1;
                queueSdkWarmup(1000);
            }
            return;
        }

        void loadSdk().then(loaded => {
            if (loaded) {
                sdkWarmupAttempt = 0;
                return;
            }

            if (sdkWarmupAttempt < 5) {
                sdkWarmupAttempt += 1;
                queueSdkWarmup(2000);
            }
        });
    }, delayMs);
}

function installSdkWarmupListeners() {
    if (sdkWarmupListenersInstalled) return;

    sdkWarmupListenersInstalled = true;
    window.addEventListener('account-switched', () => {
        sdkWarmupAttempt = 0;
        queueSdkWarmup();
    });
    window.addEventListener('storage', () => {
        sdkWarmupAttempt = 0;
        queueSdkWarmup();
    });
}

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


export async function init() {
    const status = await getStatus();

    if (status.connected) {
        installSdkWarmupListeners();
        queueSdkWarmup();
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
}
