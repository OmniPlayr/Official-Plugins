import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Copy, ExternalLink, LogIn, LogOut } from 'lucide-react';
import {
    api,
    registerPluginsMenuItem,
    closePopup,
    createPopup,
    definePluginTranslations,
} from '@omniplayr/plugins';
import './YouTubeSetup.css';

const PLUGIN_ID = 'youtube@built-in';
const translations = definePluginTranslations(PLUGIN_ID);

type Step = 'loading' | 'credentials' | 'connect' | 'device' | 'success' | 'error';
type Status = { connected: boolean; client_id_set: boolean; client_id?: string };
type DeviceFlow = {
    flow_id: string;
    user_code: string;
    verification_url: string;
    verification_url_complete?: string;
    interval: number;
};

async function getStatus(): Promise<Status> {
    return await api('/plugin/youtube/status') as Status;
}

async function saveCredentials(clientId: string, clientSecret: string): Promise<void> {
    await api('/plugin/youtube/setup', { client_id: clientId, client_secret: clientSecret });
}

async function startAuth(): Promise<DeviceFlow> {
    return await api('/plugin/youtube/auth/start', {}) as DeviceFlow;
}

async function pollAuth(flowId: string): Promise<{ connected: boolean; pending?: boolean; slow_down?: boolean }> {
    return await api('/plugin/youtube/auth/poll', { flow_id: flowId }) as {
        connected: boolean;
        pending?: boolean;
        slow_down?: boolean;
    };
}

async function disconnect(): Promise<void> {
    await api('/plugin/youtube/disconnect', undefined, undefined, true, false, 'DELETE');
}

function YoutubeSetup({ onDone }: { onDone: () => void }) {
    const { t } = translations.useTranslation();
    const [step, setStep] = useState<Step>('loading');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [deviceFlow, setDeviceFlow] = useState<DeviceFlow | null>(null);
    const [errorMsg, setErrorMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [copied, setCopied] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        getStatus()
            .then(status => {
                if (status.connected) {
                    onDone();
                } else if (status.client_id_set) {
                    setClientId(status.client_id ?? '');
                    setStep('connect');
                } else {
                    setStep('credentials');
                }
            })
            .catch(() => {
                setErrorMsg(t('youtube.setup.error.backend'));
                setStep('error');
            });
    }, []);

    useEffect(() => {
        if (step === 'credentials') setTimeout(() => inputRef.current?.focus(), 50);
    }, [step]);

    useEffect(() => {
        if (step !== 'device' || !deviceFlow) return;

        let cancelled = false;
        let timeoutId = 0;
        let intervalMs = Math.max(1, deviceFlow.interval) * 1000;

        const check = async () => {
            try {
                const result = await pollAuth(deviceFlow.flow_id);
                if (cancelled) return;
                if (result.connected) {
                    setStep('success');
                    window.setTimeout(onDone, 2000);
                    return;
                }
                if (result.slow_down) intervalMs += 5000;
                timeoutId = window.setTimeout(check, intervalMs);
            } catch {
                if (cancelled) return;
                setErrorMsg(t('youtube.setup.error.login-expired'));
                setStep('error');
            }
        };

        timeoutId = window.setTimeout(check, intervalMs);
        return () => {
            cancelled = true;
            window.clearTimeout(timeoutId);
        };
    }, [step, deviceFlow]);

    async function handleSave() {
        if (!clientId.trim() || !clientSecret.trim()) return;
        setSaving(true);
        try {
            await saveCredentials(clientId.trim(), clientSecret.trim());
            setStep('connect');
        } catch {
            setErrorMsg(t('youtube.setup.error.save-credentials'));
            setStep('error');
        } finally {
            setSaving(false);
        }
    }

    async function handleConnect() {
        setConnecting(true);
        try {
            const flow = await startAuth();
            setDeviceFlow(flow);
            setStep('device');
        } catch {
            setErrorMsg(t('youtube.setup.error.start-auth'));
            setStep('error');
        } finally {
            setConnecting(false);
        }
    }

    function copy(value: string) {
        const done = () => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        };

        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(value).then(done);
            return;
        }

        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        done();
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') onDone();
    }

    if (step === 'loading') return null;

    return (
        <div className="yt-setup">
            {(step === 'credentials' || step === 'connect' || step === 'device') && (
                <div className="yt-steps">
                    <div className={`yt-step-dot ${step === 'credentials' ? 'yt-step-dot--active' : 'yt-step-dot--done'}`} />
                    <div className={`yt-step-dot ${step === 'connect' ? 'yt-step-dot--active' : step === 'device' ? 'yt-step-dot--done' : ''}`} />
                    <div className={`yt-step-dot ${step === 'device' ? 'yt-step-dot--active' : ''}`} />
                </div>
            )}

            <div className="yt-body">
                {step === 'error' && (
                    <>
                        <p className="yt-title">{t('youtube.setup.error.title')}</p>
                        <p className="yt-error-msg">{errorMsg}</p>
                        <div className="yt-footer">
                            <button className="yt-btn yt-btn--ghost" onClick={onDone}>{t('youtube.setup.action.close')}</button>
                            <button className="yt-btn yt-btn--secondary" onClick={() => setStep('credentials')}>{t('youtube.setup.action.start-over')}</button>
                        </div>
                    </>
                )}

                {step === 'success' && (
                    <div className="yt-success">
                        <div className="yt-success__icon"><Check size={22} strokeWidth={2.5} /></div>
                        <p className="yt-success__title">{t('youtube.setup.success.title')}</p>
                        <p className="yt-success__desc">{t('youtube.setup.success.desc')}</p>
                    </div>
                )}

                {step === 'credentials' && (
                    <>
                        <p className="yt-title">{t('youtube.setup.credentials.title')}</p>
                        <p className="yt-desc">{t('youtube.setup.credentials.desc')}</p>

                        <div className="yt-instructions">
                            <div className="yt-step"><span className="yt-step__num">1</span><span>{t('youtube.setup.credentials.step1.prefix')} <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">{t('youtube.setup.credentials.step1.link')}</a></span></div>
                            <div className="yt-step"><span className="yt-step__num">2</span><span>{t('youtube.setup.credentials.step2.prefix')} <a href="https://console.cloud.google.com/apis/library/youtube.googleapis.com" target="_blank" rel="noreferrer">{t('youtube.setup.credentials.step2.link')}</a> {t('youtube.setup.credentials.step2.suffix')}</span></div>
                            <div className="yt-step"><span className="yt-step__num">3</span><span>{t('youtube.setup.credentials.step3.prefix')} <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noreferrer">{t('youtube.setup.credentials.step3.link')}</a> {t('youtube.setup.credentials.step3.suffix')}</span></div>
                            <div className="yt-step"><span className="yt-step__num">4</span><span>{t('youtube.setup.credentials.step4.prefix')} <strong>TVs and Limited Input devices</strong></span></div>
                            <div className="yt-step"><span className="yt-step__num">5</span><span>{t('youtube.setup.credentials.step5')}</span></div>
                        </div>

                        <div className="yt-field">
                            <label className="yt-label" htmlFor="yt-client-id-input">{t('youtube.setup.credentials.client-id')}</label>
                            <input id="yt-client-id-input" ref={inputRef} className="yt-input" type="text" value={clientId} onChange={e => setClientId(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('youtube.setup.credentials.client-id-placeholder')} spellCheck={false} autoComplete="off" />
                        </div>
                        <div className="yt-field">
                            <label className="yt-label" htmlFor="yt-client-secret-input">{t('youtube.setup.credentials.client-secret')}</label>
                            <input id="yt-client-secret-input" className="yt-input" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} onKeyDown={handleKeyDown} placeholder={t('youtube.setup.credentials.client-secret-placeholder')} spellCheck={false} autoComplete="off" />
                        </div>

                        <div className="yt-footer">
                            <button className="yt-btn yt-btn--ghost" onClick={onDone}>{t('youtube.setup.action.cancel')}</button>
                            <button className="yt-btn yt-btn--primary" onClick={handleSave} disabled={!clientId.trim() || !clientSecret.trim() || saving}>{saving ? t('youtube.setup.action.saving') : t('youtube.setup.action.next')}</button>
                        </div>
                    </>
                )}

                {step === 'connect' && (
                    <>
                        <p className="yt-title">{t('youtube.setup.connect.title')}</p>
                        <p className="yt-desc">{t('youtube.setup.connect.desc')}</p>
                        <div className="yt-footer">
                            <button className="yt-btn yt-btn--ghost" onClick={() => setStep('credentials')}>{t('youtube.setup.action.back')}</button>
                            <button className="yt-btn yt-btn--youtube" onClick={handleConnect} disabled={connecting}>{connecting ? t('youtube.setup.action.starting') : t('youtube.setup.action.login')}</button>
                        </div>
                    </>
                )}

                {step === 'device' && deviceFlow && (
                    <>
                        <p className="yt-title">{t('youtube.setup.device.title')}</p>
                        <p className="yt-desc">{t('youtube.setup.device.desc')}</p>
                        <div className="yt-code-box">
                            <code>{deviceFlow.user_code}</code>
                            <button className={`yt-copy-btn${copied ? ' yt-copy-btn--copied' : ''}`} onClick={() => copy(deviceFlow.user_code)} title={t('youtube.setup.action.copy')}>
                                {copied ? <Check className="copy-icon copied" /> : <Copy className="copy-icon" />}
                            </button>
                        </div>
                        <a className="yt-link-btn" href={deviceFlow.verification_url_complete ?? deviceFlow.verification_url} target="_blank" rel="noreferrer">
                            <ExternalLink className="yt-link-icon" />
                            {t('youtube.setup.device.open')}
                        </a>
                        <div className="yt-footer">
                            <button className="yt-btn yt-btn--ghost" onClick={() => setStep('connect')}>{t('youtube.setup.action.back')}</button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function mountSetupPopup() {
    const popupId = 'youtube-setup';
    createPopup({
        id: popupId,
        title: 'YouTube',
        subtitle: translations.t('youtube.setup.desc'),
        close_button: true,
        mobileFullscreen: true,
        group: 'youtube-setup',
        content: <YoutubeSetup onDone={() => closePopup(popupId)} />,
    });
}

export function init() {
    getStatus().then(status => {
        if (status.connected) {
            registerPluginsMenuItem(PLUGIN_ID, {
                icon: LogOut,
                label: translations.t('youtube.setup.logout'),
                function: () => {
                    disconnect().then(() => location.reload());
                },
            });
        } else {
            registerPluginsMenuItem(PLUGIN_ID, {
                icon: LogIn,
                label: translations.t('youtube.setup.button'),
                function: mountSetupPopup,
                needsInteraction: true,
            });
        }
    });
}
