import api from '../../modules/api';

export async function getStatus(): Promise<{ connected: boolean; client_id_set: boolean; client_id?: string }> {
    return await api('/plugin/spotify/status') as { connected: boolean; client_id_set: boolean; client_id?: string };
}

export async function saveClientId(clientId: string): Promise<void> {
    await api('/plugin/spotify/setup', { client_id: clientId });
}

export async function startAuth(): Promise<void> {
    const result = await api('/plugin/spotify/auth/start') as { url: string };
    window.location.href = result.url;
}

export async function getValidToken(): Promise<string | null> {
    try {
        const result = await api('/plugin/spotify/token', undefined, undefined, false) as { access_token?: string };
        return result.access_token ?? null;
    } catch {
        return null;
    }
}

export async function disconnect(): Promise<void> {
    await api('/plugin/spotify/disconnect', undefined, undefined, true, false, 'DELETE');
}

export function consumeConnectedParam(): boolean {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('spotify_connected')) return false;
    params.delete('spotify_connected');
    const newSearch = params.toString();
    window.history.replaceState({}, '', newSearch ? `?${newSearch}` : window.location.pathname);
    return true;
}