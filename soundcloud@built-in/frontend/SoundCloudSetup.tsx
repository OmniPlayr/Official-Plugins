import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { consumeConnectedParam, getStatus, saveCredentials, startAuth } from './auth';
import translations from './translations';
import './SoundCloudSetup.css';

type Step = 'loading' | 'credentials' | 'connect' | 'success' | 'error';

interface Props {
    onDone: () => void;
}

export default function SoundCloudSetup({ onDone }: Props) {
    const { t } = translations.useTranslation();
    const [step, setStep] = useState<Step>('loading');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
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
            .then(status => {
                setRedirectUri(status.redirect_uri);
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
                setErrorMsg(t('setup.error.backend'));
                setStep('error');
            });
    }, []);

    useEffect(() => {
        if (step === 'credentials') setTimeout(() => inputRef.current?.focus(), 50);
    }, [step]);

    function close() {
        onDone();
    }

    async function handleSave() {
        if (!clientId.trim() || !clientSecret.trim()) return;
        setSaving(true);
        try {
            await saveCredentials(clientId.trim(), clientSecret.trim());
            setStep('connect');
        } catch {
            setErrorMsg(t('setup.error.save-credentials'));
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

        const textArea = document.createElement('textarea');
        textArea.value = redirectUri;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    function handleKeyDown(e: KeyboardEvent) {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') close();
    }

    if (step === 'loading') return null;

    return (
        <div className="sc-setup">
            {(step === 'credentials' || step === 'connect') && (
                <div className="sc-steps">
                    <div className={`sc-step-dot ${step === 'credentials' ? 'sc-step-dot--active' : 'sc-step-dot--done'}`} />
                    <div className={`sc-step-dot ${step === 'connect' ? 'sc-step-dot--active' : ''}`} />
                </div>
            )}

            <div className="sc-body">
                {step === 'error' && (
                    <>
                        <p className="sc-title">{t('setup.error.title')}</p>
                        <p className="sc-error-msg">{errorMsg}</p>
                        <div className="sc-footer">
                            <button className="sc-btn sc-btn--ghost" onClick={close}>{t('setup.action.close')}</button>
                            <button className="sc-btn sc-btn--secondary" onClick={() => setStep('credentials')}>{t('setup.action.start-over')}</button>
                        </div>
                    </>
                )}

                    {step === 'success' && (
                        <div className="sc-success">
                            <div className="sc-success__icon">
                                <Check size={22} strokeWidth={2.5} />
                            </div>
                            <p className="sc-success__title">{t('setup.success.title')}</p>
                            <p className="sc-success__desc">{t('setup.success.desc')}</p>
                        </div>
                    )}

                    {step === 'credentials' && (
                        <>
                            <p className="sc-title">{t('setup.credentials.title')}</p>
                            <p className="sc-desc">{t('setup.credentials.desc')}</p>

                            <div className="sc-instructions">
                                <div className="sc-step">
                                    <span className="sc-step__num">1</span>
                                    <span>{t('setup.credentials.step1.prefix')} <a href="https://soundcloud.com/you/apps" target="_blank" rel="noreferrer">soundcloud.com/you/apps</a> {t('setup.credentials.step1.suffix')}</span>
                                </div>
                                <div className="sc-step">
                                    <span className="sc-step__num">2</span>
                                    <span>{t('setup.credentials.step2')}</span>
                                </div>
                                <div className="sc-uri-box">
                                    <code>{redirectUri}</code>
                                    <button className={`sc-copy-btn${copied ? ' sc-copy-btn--copied' : ''}`} onClick={handleCopy} title={t('setup.action.copy')}>
                                        {copied ? <Check className="copy-icon copied" /> : <Copy className="copy-icon" />}
                                    </button>
                                </div>
                                <div className="sc-step">
                                    <span className="sc-step__num">3</span>
                                    <span>{t('setup.credentials.step3')}</span>
                                </div>
                            </div>

                            <div className="sc-field">
                                <label className="sc-label" htmlFor="sc-client-id-input">{t('setup.credentials.client-id')}</label>
                                <input
                                    id="sc-client-id-input"
                                    ref={inputRef}
                                    className="sc-input"
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={t('setup.credentials.client-id-placeholder')}
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="sc-field">
                                <label className="sc-label" htmlFor="sc-client-secret-input">{t('setup.credentials.client-secret')}</label>
                                <input
                                    id="sc-client-secret-input"
                                    className="sc-input"
                                    type="password"
                                    value={clientSecret}
                                    onChange={e => setClientSecret(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder={t('setup.credentials.client-secret-placeholder')}
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="sc-footer">
                                <button className="sc-btn sc-btn--ghost" onClick={close}>{t('setup.action.cancel')}</button>
                                <button className="sc-btn sc-btn--primary" onClick={handleSave} disabled={!clientId.trim() || !clientSecret.trim() || saving}>
                                    {saving ? t('setup.action.saving') : t('setup.action.next')}
                                </button>
                            </div>
                        </>
                    )}

                {step === 'connect' && (
                    <>
                        <p className="sc-title">{t('setup.connect.title')}</p>
                        <p className="sc-desc">{t('setup.connect.desc')}</p>
                        <div className="sc-uri-box">
                            <code>{redirectUri}</code>
                            <button className={`sc-copy-btn${copied ? ' sc-copy-btn--copied' : ''}`} onClick={handleCopy} title={t('setup.action.copy')}>
                                {copied ? <Check className="copy-icon copied" /> : <Copy className="copy-icon" />}
                            </button>
                        </div>
                        <div className="sc-footer">
                            <button className="sc-btn sc-btn--ghost" onClick={() => setStep('credentials')}>{t('setup.action.back')}</button>
                            <button className="sc-btn sc-btn--soundcloud" onClick={handleConnect} disabled={connecting}>
                                {connecting ? t('setup.action.redirecting') : t('setup.action.login')}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
