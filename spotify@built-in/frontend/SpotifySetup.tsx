import { useEffect, useRef, useState } from 'react';
import { Check, Copy, X } from 'lucide-react';
import { getStatus, saveClientId, startAuth, consumeConnectedParam } from './auth';
import { getConfig } from '../../modules/config';
import './SpotifySetup.css';

type Step = 'loading' | 'client-id' | 'connect' | 'success' | 'error';

interface Props {
    onDone: () => void;
}

export default function SpotifySetup({ onDone }: Props) {
    const [step, setStep] = useState<Step>('loading');
    const [clientId, setClientId] = useState('');
    const [savedClientId, setSavedClientId] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [saving, setSaving] = useState(false);
    const [connecting, setConnecting] = useState(false);
    const [copied, setCopied] = useState(false);
    const [closing, setClosing] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const apiUrl = getConfig('api.apiUrl');

    if (typeof apiUrl !== 'string') {
        throw new Error('api.apiUrl must be a string');
    }

    const isLocal = /localhost|127\.0\.0\.1/.test(apiUrl);

    const baseUrl = isLocal
        ? apiUrl.replace(/^https?:\/\//, 'http://')
        : apiUrl.replace(/^http:\/\//, 'https://');

    const redirectUri = baseUrl + '/api/plugin/spotify/callback';

    useEffect(() => {
        const justConnected = consumeConnectedParam();

        if (justConnected) {
            setStep('success');
            setTimeout(close, 2500);
            return;
        }

        getStatus()
            .then(s => {
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
                setErrorMsg('Could not reach the backend.');
                setStep('error');
            });
    }, []);

    useEffect(() => {
        if (step === 'client-id') {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [step]);

    function close() {
        setClosing(true);
        setTimeout(onDone, 200);
    }

    async function handleSaveClientId() {
        if (!clientId.trim()) return;
        setSaving(true);
        try {
            await saveClientId(clientId.trim());
            setSavedClientId(clientId.trim());
            setStep('connect');
        } catch {
            setErrorMsg('Failed to save Client ID. Please try again.');
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
            setErrorMsg('Could not start the Spotify login flow. Please try again.');
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

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Enter') handleSaveClientId();
        if (e.key === 'Escape') close();
    }

    if (step === 'loading') return null;

    return (
        <div className={`sp-overlay${closing ? ' sp-overlay--out' : ''}`} onClick={e => e.target === e.currentTarget && close()}>
            <div className="sp-card" role="dialog" aria-modal="true">
                <div className="sp-header">
                    <div className="sp-logo">
                        <svg className="sp-logo__icon" viewBox="0 0 496 512" fill="black">
                            <path fill="#1ed760" d="M248 8C111.1 8 0 119.1 0 256s111.1 248 248 248 248-111.1 248-248S384.9 8 248 8Z"/>
                            <path d="M406.6 231.1c-5.2 0-8.4-1.3-12.9-3.9-71.2-42.5-198.5-52.7-280.9-29.7-3.6 1-8.1 2.6-12.9 2.6-13.2 0-23.3-10.3-23.3-23.6 0-13.6 8.4-21.3 17.4-23.9 35.2-10.3 74.6-15.2 117.5-15.2 73 0 149.5 15.2 205.4 47.8 7.8 4.5 12.9 10.7 12.9 22.6 0 13.6-11 23.3-23.2 23.3zm-31 76.2c-5.2 0-8.7-2.3-12.3-4.2-62.5-37-155.7-51.9-238.6-29.4-4.8 1.3-7.4 2.6-11.9 2.6-10.7 0-19.4-8.7-19.4-19.4s5.2-17.8 15.5-20.7c27.8-7.8 56.2-13.6 97.8-13.6 64.9 0 127.6 16.1 177 45.5 8.1 4.8 11.3 11 11.3 19.7-.1 10.8-8.5 19.5-19.4 19.5zm-26.9 65.6c-4.2 0-6.8-1.3-10.7-3.6-62.4-37.6-135-39.2-206.7-24.5-3.9 1-9 2.6-11.9 2.6-9.7 0-15.8-7.7-15.8-15.8 0-10.3 6.1-15.2 13.6-16.8 81.9-18.1 165.6-16.5 237 26.2 6.1 3.9 9.7 7.4 9.7 16.5s-7.1 15.4-15.2 15.4z"/>
                        </svg>
                        <span className="sp-logo__name">Spotify</span>
                    </div>
                    <button className="sp-close" onClick={close} aria-label="Close">
                        <X size={16} />
                    </button>
                </div>

                {(step === 'client-id' || step === 'connect') && (
                    <div className="sp-steps">
                        <div className={`sp-step-dot ${step === 'client-id' ? 'sp-step-dot--active' : 'sp-step-dot--done'}`} />
                        <div className={`sp-step-dot ${step === 'connect' ? 'sp-step-dot--active' : ''}`} />
                    </div>
                )}

                <div className="sp-body">
                    {step === 'error' && (
                        <>
                            <p className="sp-title">Something went wrong</p>
                            <p className="sp-error-msg">{errorMsg}</p>
                            <div className="sp-footer">
                                <button className="sp-btn sp-btn--ghost" onClick={close}>Close</button>
                                <button className="sp-btn sp-btn--secondary" onClick={() => setStep('client-id')}>Start over</button>
                            </div>
                        </>
                    )}

                    {step === 'success' && (
                        <div className="sp-success">
                            <div className="sp-success__icon">
                                <Check size={22} strokeWidth={2.5} />
                            </div>
                            <p className="sp-success__title">Spotify connected</p>
                            <p className="sp-success__desc">You're all set. Spotify tracks will play directly in your browser.</p>
                        </div>
                    )}

                    {step === 'client-id' && (
                        <>
                            <p className="sp-title">Connect Spotify</p>
                            <p className="sp-desc">Spotify requires a free developer app to authorize playback. This takes about two minutes and only needs to be done once.</p>

                            <div className="sp-instructions">
                                <div className="sp-step">
                                    <span className="sp-step__num">1</span>
                                    <span>Go to <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer">developer.spotify.com/dashboard</a> and create a free app</span>
                                </div>
                                <div className="sp-step">
                                    <span className="sp-step__num">2</span>
                                    <span>Under <strong>Redirect URIs</strong>, add this exact URL:</span>
                                </div>
                                <div className="sp-uri-box">
                                    <code>{redirectUri}</code>
                                    <button className={`sp-copy-btn${copied ? ' sp-copy-btn--copied' : ''}`} onClick={handleCopy} title="Copy">
                                    {copied ? <Check className='copy-icon copied' />: <Copy className='copy-icon' />}
                                    </button>
                                </div>
                                <div className="sp-step">
                                    <span className="sp-step__num">3</span>
                                    <span>Copy the <strong>Client ID</strong> from the app overview and paste it below</span>
                                </div>
                            </div>

                            <div className="sp-field">
                                <label className="sp-label" htmlFor="sp-client-id-input">Client ID</label>
                                <input
                                    id="sp-client-id-input"
                                    ref={inputRef}
                                    className="sp-input"
                                    type="text"
                                    value={clientId}
                                    onChange={e => setClientId(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Paste your Client ID here"
                                    spellCheck={false}
                                    autoComplete="off"
                                />
                            </div>

                            <div className="sp-footer">
                                <button className="sp-btn sp-btn--ghost" onClick={close}>Cancel</button>
                                <button className="sp-btn sp-btn--primary" onClick={handleSaveClientId} disabled={!clientId.trim() || saving}>
                                    {saving ? 'Saving...' : 'Next'}
                                </button>
                            </div>
                        </>
                    )}

                    {step === 'connect' && (
                        <>
                            <p className="sp-title">Log in with Spotify</p>
                            <p className="sp-desc">Client ID saved. Click below to authorize OmniPlayr with your Spotify account. You'll be redirected to Spotify and back.</p>

                            <div className="sp-uri-box">
                                <code>{redirectUri}</code>
                                <button className={`sp-copy-btn${copied ? ' sp-copy-btn--copied' : ''}`} onClick={handleCopy} title="Copy">
                                    {copied ? <Check className='copy-icon copied' />: <Copy className='copy-icon' />}
                                </button>
                            </div>
                            <p className="sp-desc" style={{ marginTop: '-0.25rem' }}>Make sure this redirect URI is saved in your Spotify app.</p>

                            <div className="sp-footer">
                                <button className="sp-btn sp-btn--ghost" onClick={() => setStep('client-id')}>Back</button>
                                <button className="sp-btn sp-btn--spotify" onClick={handleConnect} disabled={connecting}>
                                    {connecting ? 'Redirecting...' : 'Log in with Spotify'}
                                </button>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}