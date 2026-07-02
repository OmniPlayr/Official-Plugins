import { api } from '@omniplayr/plugins';

export async function getStatus(): Promise<{ token_set: boolean; is_admin: boolean }> {
    return await api('/plugin/artists/status') as { token_set: boolean; is_admin: boolean };
}

export async function saveToken(token: string, allAccounts = false): Promise<void> {
    await api('/plugin/artists/setup', { token, all_accounts: allAccounts });
}

export async function disconnect(): Promise<void> {
    await api('/plugin/artists/disconnect', undefined, undefined, true, false, 'DELETE');
}
