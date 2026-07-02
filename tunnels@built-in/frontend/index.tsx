import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { ExternalLink, LogIn, LoaderCircle, RadioTower, Settings2, Square } from 'lucide-react';
import { makeToast } from '@wokki20/jspt';
import './tunnels.css';

import { 
    api,
    navigate, 
    registerPluginsMenuItem, 
    registerRoute,
    closePopup, 
    createPopup, 
    definePluginTranslations 
} from '@omniplayr/plugins';

const PLUGIN_ID = 'tunnels@built-in';

const translations = definePluginTranslations(PLUGIN_ID);
const iconAssets = import.meta.glob('./icons/*', {
    eager: true,
    query: '?url',
    import: 'default',
}) as Record<string, string>;

function resolveIcon(filename?: string) {
    return filename ? iconAssets[`./icons/${filename}`] : undefined;
}

type SetupField = { key: string; label: string; secret?: boolean; required?: boolean };
type Tunnel = {
    name: string;
    display_name: string;
    description: string;
    icon?: string;
    setup_url?: string;
    setup_instructions: string;
    fields: SetupField[];
    configured: boolean;
    running: boolean;
    starting: boolean;
    url?: string;
    error?: string;
    auto_start: boolean;
    auth?: { required: boolean; authenticated: boolean; domain?: string };
};

type AuthStatus = { authenticated: boolean; url?: string; error?: string; domain?: string };

function toast(message: string, error = false) {
    makeToast({
        message,
        style: error ? 'default-error' : 'default',
        icon_left: error ? 'circle-x' : 'circle-check',
        icon_left_type: 'lucide_icon',
        duration: 4000,
    });
}

type SetupDraft = {
    values: Record<string, string>;
    autoStart: boolean;
    setSaving?: (saving: boolean) => void;
};

function TunnelSetupForm({ tunnel, draft }: { tunnel: Tunnel; draft: SetupDraft }) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [autoStart, setAutoStart] = useState(tunnel.auto_start);
    const [authenticated, setAuthenticated] = useState(tunnel.auth?.authenticated ?? true);
    const [authBusy, setAuthBusy] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [domain, setDomain] = useState(tunnel.auth?.domain);
    const [saving, setSaving] = useState(false);

    draft.setSaving = setSaving;

    const { t } = translations.useTranslation();

    const updateValue = (key: string, value: string) => {
        const next = { ...values, [key]: value };
        setValues(next);
        draft.values = next;
    };

    const updateAutoStart = (enabled: boolean) => {
        setAutoStart(enabled);
        draft.autoStart = enabled;
    };

    useEffect(() => {
        if (!tunnel.auth?.required || authenticated || !authBusy) return;
        const timer = window.setInterval(async () => {
            try {
                const status = await api(`/plugin/tunnels/${encodeURIComponent(tunnel.name)}/auth`) as AuthStatus;
                if (status.error) setAuthError(status.error);
                if (status.domain) setDomain(status.domain);
                if (status.authenticated) {
                    setAuthenticated(true);
                    setAuthBusy(false);
                }
            } catch {
                return;
            }
        }, 1500);
        return () => window.clearInterval(timer);
    }, [authBusy, authenticated, tunnel.auth?.required, tunnel.name]);

    const login = async () => {
        const loginWindow = window.open('about:blank', '_blank');
        if (loginWindow) loginWindow.opener = null;
        setAuthBusy(true);
        setAuthError(null);
        try {
            const status = await api(
                `/plugin/tunnels/${encodeURIComponent(tunnel.name)}/auth`,
                {}, undefined, true, false, 'POST',
            ) as AuthStatus;
            if (status.url && loginWindow) loginWindow.location.href = status.url;
            else if (status.url) window.open(status.url, '_blank', 'noopener,noreferrer');
            if (status.domain) setDomain(status.domain);
            if (status.error) {
                loginWindow?.close();
                setAuthError(status.error);
                setAuthBusy(false);
                return;
            }
            if (status.authenticated) {
                setAuthenticated(true);
                setAuthBusy(false);
            }
        } catch {
            loginWindow?.close();
            setAuthBusy(false);
            setAuthError(t('error.login', { name: tunnel.display_name }));
        }
    };

    return (
        <div className="tunnel-modal-body">
            {saving && <div className="tunnel-starting">
                <LoaderCircle className="spin" />
                <span>
                    <strong>{t('popup.starting', { name: tunnel.display_name })}</strong>
                    <small>{t('popup.starting.desc')}</small>
                </span>
            </div>}
            <p>{tunnel.setup_instructions}</p>
            {tunnel.auth?.required && !authenticated && <div className="tunnel-auth-step">
                <strong>{t('popup.login_first', { name: tunnel.display_name })}</strong>
                <p>{t('popup.login_first.desc')}</p>
                <button type="button" onClick={login} disabled={authBusy || saving}>
                    {authBusy ? <LoaderCircle className="spin" /> : <LogIn />}
                    {t(authBusy ? 'popup.waiting_login' : 'popup.login', { name: tunnel.display_name })}
                </button>
                {authError && <p className="tunnel-error">{authError}</p>}
            </div>}
            {authenticated && tunnel.setup_url && <a className="tunnel-setup-link" href={tunnel.setup_url} target="_blank" rel="noreferrer">{t('popup.open_dashboard', { name: tunnel.display_name })}<ExternalLink /></a>}
            {authenticated && tunnel.fields.map(field => (
                <label className="tunnel-field" key={field.key}>
                    <span>{field.label}</span>
                    {field.key === 'SUBDOMAIN' && domain ? <div className="tunnel-hostname-field">
                        <input disabled={saving} type="text" value={values[field.key] ?? ''} onChange={e => updateValue(field.key, e.target.value)} placeholder="music" />
                        <span>.{domain}</span>
                    </div> : <input disabled={saving} type={field.secret ? 'password' : 'text'} value={values[field.key] ?? ''} onChange={e => updateValue(field.key, e.target.value)} placeholder={tunnel.configured ? t('popup.replace_value') : t('popup.enter_value', { name: field.label.toLowerCase() }) } />}
                </label>
            ))}
            {authenticated && <label className="tunnel-setup-auto">
                <input disabled={saving} className="switch" type="checkbox" checked={autoStart} onChange={e => updateAutoStart(e.target.checked)} />
                <span>
                    <strong>{t('popup.start_auto')}</strong>
                    <small>{t('popup.start_auto.desc')}</small>
                </span>
            </label>}
        </div>
    );
}

function TunnelsPage() {
    const [role, setRole] = useState<string | null>(null);
    const [tunnels, setTunnels] = useState<Tunnel[]>([]);
    const [busy, setBusy] = useState<string | null>(null);

    const { t } = translations.useTranslation();

    const refresh = useCallback(async () => {
        const result = await api('/plugin/tunnels') as Tunnel[];
        setTunnels(result);
    }, []);

    useEffect(() => {
        api('get_account', undefined, { account_id: 'me' })
            .then((account: any) => {
                setRole(account?.role ?? 'user');
                if (account?.role === 'admin') refresh().catch(() => toast(t('error.load_tunnels'), true));
            })
            .catch(() => setRole('user'));
    }, [refresh]);

    if (role === null) return <div className="tunnels-loading"><LoaderCircle /></div>;
    if (role !== 'admin') return <Navigate to="/" replace />;

    const openSetup = (tunnel: Tunnel) => {
        const popupId = `tunnel-setup-${tunnel.name}`;
        const draft: SetupDraft = { values: {}, autoStart: tunnel.auto_start };
        let saving = false;

        const save = async () => {
            if (saving) return;
            if (!tunnel.configured && tunnel.fields.some(field => field.required && !draft.values[field.key]?.trim())) {
                toast(t('error.fill_details'), true);
                return;
            }
            saving = true;
            draft.setSaving?.(true);
            setBusy(tunnel.name);
            try {
                await api(
                    `/plugin/tunnels/${encodeURIComponent(tunnel.name)}/setup`,
                    { values: draft.values, auto_start: draft.autoStart },
                    undefined,
                    true,
                    false,
                    'PUT',
                );
                closePopup(popupId);
                await refresh();
                toast(t('success.setup', { name: tunnel.display_name }));
            } catch {
                toast(t('error.finish_setup', { name: tunnel.display_name }), true);
            } finally {
                saving = false;
                draft.setSaving?.(false);
                setBusy(null);
            }
        };

        createPopup({
            id: popupId,
            title: t(tunnel.configured ? 'popup.title.edit' : 'popup.title.setup', { name: tunnel.display_name }),
            subtitle: t('popup.subtitle'),
            close_button: true,
            mobileFullscreen: true,
            content: <TunnelSetupForm tunnel={tunnel} draft={draft} />,
            buttons: [
                { label: t('popup.cancel'), type: 'secondary', onClick: () => closePopup(popupId) },
                { label: t('popup.save_start'), type: 'primary', onClick: save },
            ],
        });
    };

    const request = async (tunnel: Tunnel, action: 'start' | 'stop') => {
        setBusy(tunnel.name);
        try {
            await api(`/plugin/tunnels/${encodeURIComponent(tunnel.name)}/${action}`, {}, undefined, true, false, 'POST');
            await refresh();
        } catch {
            toast(t(`error.${action}`, { name: tunnel.display_name }), true);
        } finally {
            setBusy(null);
        }
    };

    const updateAutoStart = async (tunnel: Tunnel, enabled: boolean) => {
        setTunnels(current => current.map(item => item.name === tunnel.name ? { ...item, auto_start: enabled } : item));
        try {
            await api(
                `/plugin/tunnels/${encodeURIComponent(tunnel.name)}/auto-start`,
                { enabled }, undefined, true, false, 'PUT',
            );
        } catch {
            await refresh();
            toast(t('error.save_auto_start'), true);
        }
    };

    return (
        <div className="tunnels-page">
            <header className="tunnels-header">
                <div>
                    <h1>{t('page.title')}</h1>
                    <p>{t('page.description')}</p>
                </div>
                <span className="tunnels-count">{t('page.running_count', { count: tunnels.filter(t => t.running).length })}</span>
            </header>

            <div className="tunnels-list">
                {tunnels.map(tunnel => {
                    const icon = resolveIcon(tunnel.icon);

                    return <article className="tunnel-card" key={tunnel.name}>
                        <div className="tunnel-identity">
                            <div className="tunnel-icon">
                                {icon ? <img src={icon} alt="" /> : <RadioTower />}
                            </div>
                            <div>
                                <div className="tunnel-name-row">
                                    <h2>{tunnel.display_name}</h2>
                                    <span className={`tunnel-status ${tunnel.running ? 'is-running' : ''}`}>
                                        {t(tunnel.running ? 'status.running' : tunnel.configured ? 'status.stopped' : 'status.setup_needed')}
                                    </span>
                                </div>
                                <p>{tunnel.description}</p>
                                {tunnel.url && <a className="tunnel-url" href={tunnel.url} target="_blank" rel="noreferrer">{tunnel.url}<ExternalLink /></a>}
                                {tunnel.error && <p className="tunnel-error">{tunnel.error}</p>}
                            </div>
                        </div>
                        <div className="tunnel-controls">
                            <label className="tunnel-auto-start">
                                <input className="switch" type="checkbox" checked={tunnel.auto_start} onChange={e => updateAutoStart(tunnel, e.target.checked)} />
                                {t('controls.auto_start')}
                            </label>
                            <button data-type="secondary" onClick={() => openSetup(tunnel)}><Settings2 />{t(tunnel.configured ? 'controls.edit_setup' : 'controls.setup')}</button>
                            <button disabled={busy === tunnel.name || (!tunnel.configured && !tunnel.running)} onClick={() => request(tunnel, tunnel.running ? 'stop' : 'start')}>
                                {busy === tunnel.name ? <LoaderCircle className="spin" /> : tunnel.running ? <Square /> : <RadioTower />}
                                {t(tunnel.running ? 'controls.stop' : 'controls.start')}
                            </button>
                        </div>
                    </article>;
                })}
            </div>

        </div>
    );
}

export function init() {
    registerRoute({ path: '/tunnels', component: TunnelsPage });
    registerPluginsMenuItem(PLUGIN_ID, {
        icon: RadioTower,
        label: translations.t('menu.manage'),
        function: () => navigate('/tunnels'),
        adminOnly: true,
    });
}
