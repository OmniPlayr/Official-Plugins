import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { getStatus, saveClientId, startAuth, consumeConnectedParam } from './auth';
import translations from './translations';
import './SpotifySetup.css';

type Step = 'loading' | 'client-id' | 'connect' | 'success' | 'error';

interface Props {
    onDone: () => void;
}

export default function SpotifySetup({ onDone }: Props) {
    const { t } = translations.useTranslation();
    const [step, setStep] = useState<Step>('loading');
    const [clientId, setClientId] = useState('');
    const [savedClientId, setSavedClientId] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [redirectUri, setRedirectUri] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const justConnected = consumeConnectedParam();

        if (justConnected) {
            setStep('success');
            setTimeout(close, 2500);
            return;
        }

        getStatus()
            .then(s => {
                setRedirectUri(s.redirect_uri);
                if (s.connected) {
                    onDone();
                } else if (s.client_id_set) {
                    setSavedClientId(s.client_id ?? '');
                    setClientId(s.client_id ?? '');
                    setStep('connect');
                } else {
                    setStep('client-id');
                }
            })
            .catch(() => {
                setErrorMsg(t('setup.error.backend'));
                setStep('error');
            });
    }, []);

    useEffect(() => {
        if (step === 'client-id') {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [step]);

    function close() {
        onDone();
    }

    async function handleSaveClientId() {
        if (!clientId.trim()) return;
        setSaving(true);
        try {
            await saveClientId(clientId.trim());
            setSavedClientId(clientId.trim());
            setStep('connect');
        } catch {
            setErrorMsg(t('setup.error.save-client-id'));
            setStep('error');
        } finally {
            setSaving(false);
        }
    }

    async function handleConnect() {
        setConnecting(true);
        try {
            await startAuth();
        } catch {
            setErrorMsg(t('setup.error.start-auth'));
            setStep('error');
            setConnecting(false);
        }
    }

    function handleCopy() {
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(redirectUri).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
            });
            return;
        }

        const textArea = document.createElement("textarea");
        textArea.value = redirectUri;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand("copy");
        document.body.removeChild(textArea);

        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') handleSaveClientId();
        if (e.key === 'Escape') close();
    }

    if (step === 'loading') return null;

    return (
        <div className="sp-setup">
                {(step === 'client-id' || step === 'connect') && (
                    <div className="sp-steps">
                        <div className={`sp-step-dot ${step === 'client-id' ? 'sp-step-dot--active' : 'sp-step-dot--done'}`} />
                        <div className={`sp-step-dot ${step === 'connect' ? 'sp-step-dot--active' : ''}`} />
                    </div>
                )}

                <div className="sp-body">
                    {step === 'error' && (
                        <>
                            <p className="sp-title">{t('setup.error.title')}</p>
                            <p className="sp-error-msg">{errorMsg}</p>
                            <div className="sp-footer">
                                <button className="sp-btn sp-btn--ghost" onClick={close}>{t('setup.action.close')}</button>
                                <button className="sp-btn sp-btn--secondary" onClick={() => setStep('client-id')}>{t('setup.action.start-over')}</button>
                            </div>
                        </>
                    )}

                    {step === 'success' && (
                        <div className="sp-success">
                            <div className="sp-success__icon">
                                <Check size={22} strokeWidth={2.5} />
                            </div>
                            <p className="sp-success__title">{t('setup.success.title')}</p>
                            <p className="sp-success__desc">{t('setup.success.desc')}</p>
                        </div>
                    )}

                    {step === 'client-id' && (
                        <>
                            <p className="sp-title">{t('setup.client.title')}</p>
                            <p className="sp-desc">{t('setup.client.desc')}</p>

                            <div className="sp-instructions">
                                <div className="sp-step">
                                    <span className="sp-step__num">1</span>
                                    <span>{t('setup.client.step1.prefix')} <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> {t('setup.client.step1.suffix')}</span>
                                </div>
                                <div className="sp-step">
                                    <span className="sp-step__num">2</span>
                                    <span>{t('setup.client.step2.prefix')} <strong>Redirect URIs</strong>{t('setup.client.step2.suffix')}</span>
                                </div>
                                <div className="sp-uri-box">
                                    <code>{redirectUri}</code>
                                    <button className={`sp-copy-btn${copied ? ' sp-copy-btn--copied' : ''}`} onClick={handleCopy} title={t('setup.action.copy')}>
                                    {copied ? <Check className='copy-icon copied' />: <Copy className='copy-icon' />}
                                    </button>
                                </div>
                                <div className="sp-step">
                                    <span className="sp-step__num">3</span>
                                    <span>{t('setup.client.step3.prefix')} <strong>Client ID</strong> {t('setup.client.step3.suffix')}</span>
                                </div>
                            </div>

                            <div className="sp-field">
                                <label className="sp-label" htmlFor="sp-client-id-input">{t('setup.client.label')}</label>
                                <input
                                    id="sp-client-id-input"
                                    ref={inputRef}
                                    className="sp-input"
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={t('setup.client.placeholder')}
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="sp-footer">
                                <button className="sp-btn sp-btn--ghost" onClick={close}>{t('setup.action.cancel')}</button>
                                <button className="sp-btn sp-btn--primary" onClick={handleSaveClientId} disabled={!clientId.trim() || saving}>
                                    {saving ? t('setup.action.saving') : t('setup.action.next')}
                                </button>
                            </div>
                        </>
                    )}

                    {step === 'connect' && (
                        <>
                            <p className="sp-title">{t('setup.connect.title')}</p>
                            <p className="sp-desc">{t('setup.connect.desc')}</p>

                            <div className="sp-uri-box">
                                <code>{redirectUri}</code>
                                <button className={`sp-copy-btn${copied ? ' sp-copy-btn--copied' : ''}`} onClick={handleCopy} title={t('setup.action.copy')}>
                                    {copied ? <Check className='copy-icon copied' />: <Copy className='copy-icon' />}
                                </button>
                            </div>
                            <p className="sp-desc" style={{ marginTop: '-0.25rem' }}>{t('setup.connect.redirect-note')}</p>

                            <div className="sp-footer">
                                <button className="sp-btn sp-btn--ghost" onClick={() => setStep('client-id')}>{t('setup.action.back')}</button>
                                <button className="sp-btn sp-btn--spotify" onClick={handleConnect} disabled={connecting}>
                                    {connecting ? t('setup.action.redirecting') : t('setup.action.login')}
                                </button>
                            </div>
                        </>
                    )}
                </div>
        </div>
    );

}
