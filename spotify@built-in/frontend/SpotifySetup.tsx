import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import { getStatus, saveClientId, startAuth, consumeConnectedParam } from './auth';
import { getConfig } from '../../modules/config'; // This import is not in the SDK so that is why it shows an error, but it works fine
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
    );

}
