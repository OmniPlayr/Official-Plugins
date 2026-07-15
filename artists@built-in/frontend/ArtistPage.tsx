import { useParams } from 'react-router-dom';
import {api} from '@omniplayr/plugins';
import { artistCache } from './artistCache';
import { useEffect, useState, useRef } from 'react';
import jspt from "@wokki20/jspt";
import unknownProfile from '../../assets/images/unknown-profile.svg';
import unknownArtwork from '../../assets/images/unknown-art.svg';
import { useNavigate } from 'react-router-dom';
import translations from './translations';
import TranslatedRichText from './TranslatedRichText';

async function getArtist(artist_name: string, song?: string, album?: string) {
    if (artistCache.has(artist_name)) {
        const cached = artistCache.get(artist_name);
        return { ...cached, client_time: 0 };
    }
    const start = performance.now();
    const params = new URLSearchParams({
        ...(song ? { song } : {}),
        ...(album ? { album } : {}),
    });
    const query = params.size ? `?${params}` : '';
    const res = await api(`/plugin/artist/${encodeURIComponent(artist_name)}${query}`) as any;
    const end = performance.now();
    artistCache.set(artist_name, res);
    return { ...res, client_time: +(end - start).toFixed(2) };
}

function twemojiFlagURL(countryCode?: string) {
    if (!countryCode) return `https://github.com/twitter/twemoji/raw/master/assets/svg/2753.svg`;
    const codePoints = countryCode
        .toUpperCase()
        .split("")
        .map(c => (127397 + c.charCodeAt(0)).toString(16));
    return `https://github.com/twitter/twemoji/raw/master/assets/svg/${codePoints.join("-")}.svg`;
}

function getCountryName(countryCode: string | undefined, fallback: string) {
    if (!countryCode) return fallback;
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
}

function showInfoPopup(t: (key: string) => string) {
    jspt.makePopup({
        header: t('info.title'),
        content_type: 'html',
        content: `
            <p>${t('info.intro')}</p>
            <ul>
                <li>${t('info.item.bio')}</li>
                <li>${t('info.item.origin')}</li>
                <li>${t('info.item.active')}</li>
                <li>${t('info.item.genres')}</li>
                <li>${t('info.item.discography')}</li>
            </ul>
            <p>${t('info.search')}</p>
            <p>${t('info.sources')}</p>
            <ul>
                <li><strong>MusicBrainz</strong> - ${t('info.source.musicbrainz')}</li>
                <li><strong>Genius</strong> - ${t('info.source.genius')}</li>
                <li><strong>Cover Art Archive</strong> - ${t('info.source.cover_art')}</li>
            </ul>
            <p>${t('info.cache')}</p>
            <p>${t('info.corrections')}</p>
            <ul>
                <li><a href="https://musicbrainz.org" class="link" target="_blank">musicbrainz.org</a></li>
                <li><a href="https://genius.com" class="link" target="_blank">genius.com</a></li>
                <li><a href="https://coverartarchive.org" class="link" target="_blank">coverartarchive.org</a></li>
            </ul>
            <p>${t('info.contribution')}</p>
        `
    })
}

const notFoundVariants = [
    { title: "not_found.0.title", text: "not_found.0.text", fun: "not_found.0.fun", link: "https://en.wikipedia.org/wiki/Anglo-Zanzibar_War" },
    { title: "not_found.1.title", text: "not_found.1.text", fun: "not_found.1.fun", link: "https://en.wikipedia.org/wiki/Shannon_number" },
    { title: "not_found.2.title", text: "not_found.2.text", fun: "not_found.2.fun", link: "https://en.wikipedia.org/wiki/Banana" },
];

function NotFound() {
    const { t } = translations.useTranslation();
    const pick = notFoundVariants[Math.floor(Math.random() * notFoundVariants.length)];
    return (
        <div className="artist-page not-found">
            <h1 className="not-found-title">{t(pick.title)}</h1>
            <p className="not-found-text">{t(pick.text)}</p>
            <p className="not-found-fun-fact">{t(pick.fun)} <a className="link" href={pick.link} target="_blank" rel="noreferrer">{t('not_found.read_more')}</a></p>
            <button className="not-found-button" onClick={() => window.location.href = '/'}>{t('not_found.home')}</button>
        </div>
    );
}

function MissingToken() {
    const { t } = translations.useTranslation();
    return (
        <div className="artist-page not-found">
            <h1 className="not-found-title">{t('missing_token.title')}</h1>
            <p className="not-found-text">{t('missing_token.text')}</p>
            <button className="not-found-button" onClick={() => window.location.href = '/settings/plugins'}>{t('missing_token.button')}</button>
        </div>
    );
}

const FALLBACK_DURATION = 2000;

function useLoadingProgress(loading: boolean, estimatedMs: number) {
    const [progress, setProgress] = useState(0);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const startRef = useRef<number | null>(null);

    useEffect(() => {
        if (loading) {
            setProgress(0);
            startRef.current = performance.now();
            intervalRef.current = setInterval(() => {
                const elapsed = performance.now() - startRef.current!;
                const raw = elapsed / estimatedMs;
                setProgress(Math.min(0.9, raw));
            }, 50);
        } else {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setProgress(1);
            const t = setTimeout(() => setProgress(0), 400);
            return () => clearTimeout(t);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [loading, estimatedMs]);

    return progress;
}

function ArtistPage() {
    const { artist } = useParams<{ artist: string }>();
    const [data, setData] = useState<any>(null);
    const [notFound, setNotFound] = useState(false);
    const [missingToken, setMissingToken] = useState(false);
    const [loading, setLoading] = useState(false);
    const [stickyVisible, setStickyVisible] = useState(false);
    const profileImageRef = useRef<HTMLImageElement>(null);
    const navigate = useNavigate();
    const { t } = translations.useTranslation();

    const estimatedMs = (() => {
        if (artist && artistCache.has(artist)) return 0;
        const last = Number(sessionStorage.getItem('artist-last-duration') || FALLBACK_DURATION);
        return last || FALLBACK_DURATION;
    })();

    const progress = useLoadingProgress(loading, estimatedMs);

    useEffect(() => {
        if (!artist) return;
        setData(null);
        setNotFound(false);
        setMissingToken(false);
        setLoading(true);
        const ctx = JSON.parse(sessionStorage.getItem('artist-nav-context') || '{}');
        sessionStorage.removeItem('artist-nav-context');
        getArtist(artist, ctx.song, ctx.album).then(fetched => {
            if (fetched?.client_time) {
                sessionStorage.setItem('artist-last-duration', String(fetched.client_time));
            }
            if (!fetched || !fetched.name) {
                setNotFound(true);
            } else {
                setData(fetched);
            }
            setLoading(false);
        }).catch(error => {
            if (error?.status === 401) {
                setMissingToken(true);
            } else {
                setNotFound(true);
            }
            setLoading(false);
        });
    }, [artist]);

    useEffect(() => {
        const el = profileImageRef.current;
        if (!el) return;
        const observer = new IntersectionObserver(
            ([entry]) => setStickyVisible(!entry.isIntersecting),
            { threshold: 0 }
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [data]);

    if (missingToken) return <MissingToken />;
    if (notFound) return <NotFound />;

    return (
        <div className="artist-page">
            {progress > 0 && (
                <div className="loading-bar-container">
                    <div
                        className="loading-bar"
                        style={{ width: `${progress * 100}%`, transition: progress === 1 ? 'width 0.2s ease, opacity 0.2s ease' : 'width 0.1s linear' }}
                    />
                </div>
            )}
            {loading && (
                <div className="loading-spinner-overlay">
                    <div className="loading-spinner" />
                </div>
            )}
            {!loading && data && (<>
            <div className={`artist-sticky-bar ${stickyVisible ? 'visible' : ''}`}>
                <div className="artist-sticky-bar-left">
                    <img
                        className="artist-sticky-image"
                        src={data.genius_image || unknownProfile}
                        alt={data.name}
                        draggable={false}
                    />
                    <p className="artist-sticky-name">{data.name}</p>
                </div>
                <div className="artist-sticky-bar-right">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-info artist-page-info-icon" onClick={() => showInfoPopup(t)}>
                        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                    </svg>
                </div>
            </div>
            <div className={`artist-page-header ${!data.genius_banner ? 'no-banner' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-info artist-page-info-icon" onClick={() => showInfoPopup(t)}>
                    <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                </svg>
                <img className="artist-page-banner" draggable={false} src={data.genius_banner} alt={data.name} />
                <img
                    ref={profileImageRef}
                    className="artist-page-image"
                    draggable={false}
                    src={data.genius_image || unknownProfile}
                    alt={data.name}
                />
                <div className="artist-page-info">
                    <p className="artist-page-name">{data.name}</p>
                    <p className="artist-page-country">
                        <img className="emoji-flag" draggable={false} src={twemojiFlagURL(data.country)} alt={t('field.unknown')} />
                        {getCountryName(data.country, t('country.unknown'))}
                    </p>
                </div>
            </div>
            <div className={`artist-page-content ${!data.genius_banner ? 'no-banner' : ''}`}>
                <div className="artist-page-content-item">
                    <h2 className="artist-page-title">{t('section.about', { name: data.name })}</h2>
                    <div className="artist-page-info-items">
                        {data.active_from &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">{t('field.active_from')}</p>
                            <p className="artist-page-info-item-value">{data.active_from || t('field.unknown')}</p>
                        </div>
                        }
                        {data.active_until &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">{t('field.active_until')}</p>
                            <p className="artist-page-info-item-value">{data.active_until || t('field.unknown')}</p>
                        </div>
                        }
                    </div>
                    <p className="artist-page-info-item-key artist-page-genres-key">{t('field.genres')}</p>
                    <div className="artist-page-info-genres">
                        {data.genres?.map((genre: string, i: number) => <p key={i} className="artist-page-info-genre">{genre}</p>)}
                    </div>
                    <p className="artist-page-info-item-key artist-page-bio-key">{t('field.bio')}</p>
                    <p className="artist-page-bio artist-page-info-item-value">{data.bio || t('field.no_bio')}</p>
                </div>
                <div className="artist-page-content-item">
                    <h2 className="artist-page-title">{t('releases.title')}</h2>
                    {(['Album', 'EP', 'Single'] as const).map(type => {
                        const filtered = data.releases
                            ?.filter((r: any) => r.type === type)
                            .sort((a: any, b: any) => (b.year ?? 0) - (a.year ?? 0));
                        if (!filtered?.length) return null;
                        return (
                            <div key={type}>
                                <h3 className="artist-page-releases-subtitle">{t(`releases.${type.toLowerCase()}_plural`)}</h3>
                                <div className="artist-page-releases">
                                    {filtered.map((release: any, i: number) => (
                                        <div
                                            key={i}
                                            className="artist-page-release artist-page-release--album"
                                            onClick={() => {
                                                sessionStorage.setItem('artist-nav-context', JSON.stringify({ type: release.type }));
                                                navigate(`/artist/${encodeURIComponent(artist || '')}/${encodeURIComponent(release.title)}`);
                                            }}
                                        >
                                            <img
                                                className="artist-page-release-image"
                                                width={100}
                                                height={100}
                                                loading="lazy"
                                                draggable={false}
                                                src={release.cover_art}
                                                alt={release.title || t('field.unknown')}
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).src = unknownArtwork; }}
                                            />
                                            <div className="artist-page-release-info">
                                                <p className="artist-page-release-name">{release.title || t('release.unknown_album')}</p>
                                                <p className="artist-page-release-date">{release.year || t('release.unknown_year')}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="artist-page-request-info">
                    <p className="artist-page-request-info-text">
                        <TranslatedRichText
                            i18nKey="request.artist"
                            values={{
                                clientTime: data.client_time || 0,
                                serverTime: data.elapsed_ms || 0,
                                cacheType: data.from_cache ? t('request.cached') : t('request.fresh'),
                                accuracyPercent: ((data.accuracy || 0) * 100).toFixed(2),
                                accuracy: data.accuracy || 0,
                            }}
                        />
                    </p>
                </div>
            </div>
            </>)}
        </div>
    );
}

export default ArtistPage
