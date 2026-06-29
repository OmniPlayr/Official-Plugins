import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Info, KeyRound, Trash2 } from 'lucide-react';
import { closePopup } from '../../modules/PopupContext';
import { disconnect, saveToken } from './auth';

interface Props {
    tokenSet: boolean;
    isAdmin: boolean;
    onDone: () => void;
}

export default function ArtistsTokenSetup({ tokenSet, isAdmin, onDone }: Props) {
    const { t } = useTranslation('artists@built-in');
    const [token, setToken] = useState('');
    const [allAccounts, setAllAccounts] = useState(false);
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    async function handleSave() {
        const value = token.trim();
        if (!value) {
            setError(t('token.popup.error.required'));
            inputRef.current?.focus();
            return;
        }

        setSaving(true);
        setError('');
        try {
            await saveToken(value, isAdmin && allAccounts);
            onDone();
            closePopup('artists-token-popup');
        } catch {
            setError(t('token.popup.error.save'));
        } finally {
            setSaving(false);
        }
    }

    async function handleClear() {
        setClearing(true);
        setError('');
        try {
            await disconnect();
            onDone();
            closePopup('artists-token-popup');
        } catch {
            setError(t('token.popup.error.clear'));
        } finally {
            setClearing(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === 'Enter') handleSave();
    }

    return (
        <div className="artists-token-popup">
            <div className="artists-token-help">
                <Info className="artists-token-help-icon" />
                <p>{t('token.popup.help')}</p>
            </div>
            <a className="artists-token-link link" href="https://genius.com/api-clients" target="_blank" rel="noreferrer">
                {t('token.popup.link')}
            </a>
            <label className="artists-token-label" htmlFor="artists-genius-token">
                {t('token.popup.label')}
            </label>
            <div className="artists-token-field">
                <KeyRound className="artists-token-field-icon" />
                <input
                    id="artists-genius-token"
                    ref={inputRef}
                    className="artists-token-input"
                    type="password"
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={tokenSet ? t('token.popup.placeholder.replace') : t('token.popup.placeholder')}
                    spellCheck={false}
                    autoComplete="off"
                    autoFocus
                />
            </div>
            {isAdmin && (
                <label className="artists-token-all-accounts">
                    <input
                        type="checkbox"
                        checked={allAccounts}
                        onChange={e => setAllAccounts(e.target.checked)}
                        disabled={saving || clearing}
                    />
                    <span>
                        <strong>{t('token.popup.all_accounts')}</strong>
                        <small>{t('token.popup.all_accounts.desc')}</small>
                    </span>
                </label>
            )}
            {error && <p className="artists-token-error">{error}</p>}
            <div className="artists-token-actions">
                {tokenSet && (
                    <button className="artists-token-button artists-token-button--danger" onClick={handleClear} disabled={clearing || saving}>
                        <Trash2 size={16} />
                        {clearing ? t('token.popup.clearing') : t('token.popup.clear')}
                    </button>
                )}
                <button className="artists-token-button artists-token-button--primary" onClick={handleSave} disabled={saving || clearing}>
                    <Check size={16} />
                    {saving ? t('token.popup.saving') : t('common.save', { ns: 'translation' })}
                </button>
            </div>
        </div>
    );
}
