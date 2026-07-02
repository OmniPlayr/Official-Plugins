import {api} from '@omniplayr/plugins';

export async function getStatus(): Promise<{ connected: boolean; client_id_set: boolean; client_id?: string }> {
    return await api('/plugin/soundcloud/status') as { connected: boolean; client_id_set: boolean; client_id?: string };
}

export async function saveCredentials(clientId: string, clientSecret: string): Promise<void> {
    await api('/plugin/soundcloud/setup', { client_id: clientId, client_secret: clientSecret });
}

export async function startAuth(): Promise<void> {
    const result = await api('/plugin/soundcloud/auth/start') as { url: string };
    window.location.href = result.url;
}

export async function getTrack(trackId: string): Promise<{ id: string; url: string; metadata: Record<string, unknown> }> {
    return await api('/plugin/soundcloud/track', { song_id: trackId }) as {
        id: string;
        url: string;
        metadata: Record<string, unknown>;
    };
}

export async function disconnect(): Promise<void> {
    await api('/plugin/soundcloud/disconnect', undefined, undefined, true, false, 'DELETE');
}

export function consumeConnectedParam(): boolean {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('soundcloud_connected')) return false;
    params.delete('soundcloud_connected');
    const newSearch = params.toString();
    window.history.replaceState({}, '', newSearch ? `?${newSearch}` : window.location.pathname);
    return true;
}
