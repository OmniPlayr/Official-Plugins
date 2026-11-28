import { getAccount } from '@omniplayr/plugins';

const FRONTEND_DEV_PORTS = new Set(['8223', '8323', '8523']);

export function devicesPluginWebSocketUrl(path: string) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = new URL(window.location.href);

    if (FRONTEND_DEV_PORTS.has(url.port)) {
        url.port = '8224';
    }

    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `/api${normalizedPath}`;
    url.search = '';
    url.hash = '';

    const token = window.localStorage.getItem('access_token');
    if (token) {
        url.searchParams.set('token', token);
    }

    const accountToken = getAccount();
    if (accountToken) {
        url.searchParams.set('account_token', accountToken);
    }

    return url.toString();
}
