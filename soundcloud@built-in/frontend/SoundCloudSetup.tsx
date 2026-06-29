import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { consumeConnectedParam, getStatus, saveCredentials, startAuth } from './auth';
import { getConfig } from '../../modules/config';
import './SoundCloudSetup.css';

type Step = 'loading' | 'credentials' | 'connect' | 'success' | 'error';

interface Props {
    onDone: () => void;
}

export default function SoundCloudSetup({ onDone }: Props) {
    const [step, setStep] = useState<Step>('loading');
    const [clientId, setClientId] = useState('');
    const [clientSecret, setClientSecret] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [closing, setClosing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const apiUrl = getConfig('api.apiUrl');
    if (typeof apiUrl !== 'string') throw new Error('api.apiUrl must be a string');

    const isLocal = /localhost|127\.0\.0\.1/.test(apiUrl);
    const baseUrl = isLocal
        ? apiUrl.replace(/^https?:\/\//, 'http://')
        : apiUrl.replace(/^http:\/\//, 'https://');
    const redirectUri = baseUrl + '/api/plugin/soundcloud/callback';

    useEffect(() => {
        const justConnected = consumeConnectedParam();
        if (justConnected) {
            setStep('success');
            setTimeout(close, 2500);
            return;
        }

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
                setErrorMsg('Could not reach the backend.');
                setStep('error');
            });
    }, []);

    useEffect(() => {
        if (step === 'credentials') setTimeout(() => inputRef.current?.focus(), 50);
    }, [step]);

    function close() {
        setClosing(true);
        setTimeout(onDone, 200);
    }

    async function handleSave() {
        if (!clientId.trim() || !clientSecret.trim()) return;
        setSaving(true);
        try {
            await saveCredentials(clientId.trim(), clientSecret.trim());
            setStep('connect');
        } catch {
            setErrorMsg('Failed to save SoundCloud app credentials. Please try again.');
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
            setErrorMsg('Could not start the SoundCloud login flow. Please try again.');
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

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') handleSave();
        if (e.key === 'Escape') close();
    }

    if (step === 'loading') return null;

    return (
        <div className={`sc-overlay${closing ? ' sc-overlay--out' : ''}`} onClick={e => e.target === e.currentTarget && close()}>
            <div className="sc-card" role="dialog" aria-modal="true">
                <div className="sc-header">
                    <div className="sc-logo">
                        <span className="sc-logo__mark">SC</span>
                        <span className="sc-logo__name">SoundCloud</span>
                    </div>
                    <button className="sc-close" onClick={close} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>

                {(step === 'credentials' || step === 'connect') && (
                    <div className="sc-steps">
                        <div className={`sc-step-dot ${step === 'credentials' ? 'sc-step-dot--active' : 'sc-step-dot--done'}`} />
                        <div className={`sc-step-dot ${step === 'connect' ? 'sc-step-dot--active' : ''}`} />
                    </div>
                )}

                <div className="sc-body">
                    {step === 'error' && (
                        <>
                            <p className="sc-title">Something went wrong</p>
                            <p className="sc-error-msg">{errorMsg}</p>
                            <div className="sc-footer">
                                <button className="sc-btn sc-btn--ghost" onClick={close}>Close</button>
                                <button className="sc-btn sc-btn--secondary" onClick={() => setStep('credentials')}>Start over</button>
                            </div>
                        </>
                    )}

                    {step === 'success' && (
                        <div className="sc-success">
                            <div className="sc-success__icon">
                                <Check size={22} strokeWidth={2.5} />
                            </div>
                            <p className="sc-success__title">SoundCloud connected</p>
                            <p className="sc-success__desc">SoundCloud tracks and playlists are ready in OmniPlayr.</p>
                        </div>
                    )}

                    {step === 'credentials' && (
                        <>
                            <p className="sc-title">Connect SoundCloud</p>
                            <p className="sc-desc">Create or open a SoundCloud developer app, add the redirect URI below, then paste the app credentials.</p>

                            <div className="sc-instructions">
                                <div className="sc-step">
                                    <span className="sc-step__num">1</span>
                                    <span>Go to <a href="https://developers.soundcloud.com" target="_blank" rel="noreferrer">developers.soundcloud.com</a> and create an app</span>
                                </div>
                                <div className="sc-step">
                                    <span className="sc-step__num">2</span>
                                    <span>Add this exact redirect URI to the app:</span>
                                </div>
                                <div className="sc-uri-box">
                                    <code>{redirectUri}</code>
                                    <button className={`sc-copy-btn${copied ? ' sc-copy-btn--copied' : ''}`} onClick={handleCopy} title="Copy">
                                        {copied ? <Check className="copy-icon copied" /> : <Copy className="copy-icon" />}
                                    </button>
                                </div>
                                <div className="sc-step">
                                    <span className="sc-step__num">3</span>
                                    <span>Paste the Client ID and Client Secret from the SoundCloud app</span>
                                </div>
                            </div>

                            <div className="sc-field">
                                <label className="sc-label" htmlFor="sc-client-id-input">Client ID</label>
                                <input
                                    id="sc-client-id-input"
                                    ref={inputRef}
                                    className="sc-input"
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Paste your Client ID"
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="sc-field">
                                <label className="sc-label" htmlFor="sc-client-secret-input">Client Secret</label>
                                <input
                                    id="sc-client-secret-input"
                                    className="sc-input"
                                    type="password"
                                    value={clientSecret}
                                    onChange={e => setClientSecret(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Paste your Client Secret"
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="sc-footer">
                                <button className="sc-btn sc-btn--ghost" onClick={close}>Cancel</button>
                                <button className="sc-btn sc-btn--primary" onClick={handleSave} disabled={!clientId.trim() || !clientSecret.trim() || saving}>
                                    {saving ? 'Saving...' : 'Next'}
                                </button>
                            </div>
                        </>
                    )}

                    {step === 'connect' && (
                        <>
                            <p className="sc-title">Log in with SoundCloud</p>
                            <p className="sc-desc">Credentials saved. Authorize OmniPlayr with SoundCloud to load private playlists and track metadata.</p>
                            <div className="sc-uri-box">
                                <code>{redirectUri}</code>
                                <button className={`sc-copy-btn${copied ? ' sc-copy-btn--copied' : ''}`} onClick={handleCopy} title="Copy">
                                    {copied ? <Check className="copy-icon copied" /> : <Copy className="copy-icon" />}
                                </button>
                            </div>
                            <div className="sc-footer">
                                <button className="sc-btn sc-btn--ghost" onClick={() => setStep('credentials')}>Back</button>
                                <button className="sc-btn sc-btn--soundcloud" onClick={handleConnect} disabled={connecting}>
                                    {connecting ? 'Redirecting...' : 'Log in with SoundCloud'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
