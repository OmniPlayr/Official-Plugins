import { useParams } from 'react-router-dom';
import api from '../../modules/api';
import { artistCache } from './artistCache';
import { useEffect, useState, useRef } from 'react';
import jspt from "@wokki20/jspt";
import unknownProfile from '../../assets/images/unknown-profile.svg';
import unknownArtwork from '../../assets/images/unknown-art.svg';
import { useNavigate } from 'react-router-dom';

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
    const res = await api(`/plugin/artist/${artist_name}${query}`) as any;
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

function getCountryName(countryCode?: string) {
    if (!countryCode) return "Unknown Country";
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(countryCode);
}

function showInfoPopup() {
    jspt.makePopup({
        header: 'About Artist Profiles',
        content_type: 'html',
        content: `
            <p>Artist Profiles give you a quick overview of any musician or band:</p>
            <ul>
                <li>their biography</li>
                <li>where they're from</li>
                <li>when they were active</li>
                <li>what genres they play</li>
                <li>and a snapshot of their discography including albums, singles, and EPs.</li>
            </ul>
            <p>Just search for an artist by name and their profile will load automatically.</p>
            <p>Profile data is pulled from three sources:</p>
            <ul>
                <li><strong>MusicBrainz</strong> - provides metadata like country of origin, active years, genre tags, and release discography (albums, singles, EPs).</li>
                <li><strong>Genius</strong> - provides artist biography, profile image, and banner image.</li>
                <li><strong>Cover Art Archive</strong> - provides album and release artwork.</li>
            </ul>
            <p>Profiles are cached locally after the first load, so they open instantly on repeat visits.</p>
            <p>If you notice missing or incorrect information, the best way to help is to submit corrections directly to the source databases:</p>
            <ul>
                <li><strong>MusicBrainz</strong> - for missing artists, wrong metadata, or incomplete discographies: <a href="https://musicbrainz.org" class="link" target="_blank">musicbrainz.org</a></li>
                <li><strong>Genius</strong> - for missing or incorrect artist bios and images: <a href="https://genius.com" class="link" target="_blank">genius.com</a></li>
                <li><strong>Cover Art Archive</strong> - for missing release artwork: <a href="https://coverartarchive.org" class="link" target="_blank">coverartarchive.org</a></li>
            </ul>
            <p>Since profiles are sourced directly from these databases, any contributions you make there will automatically show up here.</p>
        `
    })
}

const notFoundVariants = [
    { title: "Artist Not Found", text: "We searched everywhere we could, MusicBrainz, Genius, and even asked a guy who only listens to vinyl... nothing.", fun: "Fun fact: The shortest war in history lasted only 35-45 minutes.", link: "https://en.wikipedia.org/wiki/Anglo-Zanzibar_War" },
    { title: "No Results", text: "This artist is more hidden than an unreleased track on a scratched CD.", fun: "Fun fact: Octopuses have three hearts.", link: "https://en.wikipedia.org/wiki/Octopus" },
    { title: "404: Artist Missing", text: "We tried autocorrect, spellcheck, and even vibes... still nothing.", fun: "Fun fact: Bananas are technically berries, but strawberries aren't.", link: "https://en.wikipedia.org/wiki/Banana" },
    { title: "Silence...", text: "Even the servers went quiet trying to find this artist.", fun: "Fun fact: There are more possible chess games than atoms in the observable universe.", link: "https://en.wikipedia.org/wiki/Shannon_number" },
    { title: "Artist Not Found", text: "Either this artist doesn't exist, or they're so underground even we can't dig them up.", fun: "Fun fact: Honey never spoils. Jars found in ancient tombs are still edible.", link: "https://en.wikipedia.org/wiki/Honey" },
    { title: "Typo Maybe?", text: "Maybe you made a typo? After all keyboards are not always perfect.", fun: "Fun fact: Keyboards were originally designed to slow you down so typewriters wouldn't jam.", link: "https://en.wikipedia.org/wiki/QWERTY" },
];

function NotFound() {
    const pick = notFoundVariants[Math.floor(Math.random() * notFoundVariants.length)];
    return (
        <div className="artist-page not-found">
            <h1 className="not-found-title">{pick.title}</h1>
            <p className="not-found-text">{pick.text}</p>
            <p className="not-found-fun-fact">{pick.fun} <a className="link" href={pick.link} target="_blank" rel="noreferrer">Read more</a></p>
            <button className="not-found-button" onClick={() => window.location.href = '/'}>Take me back Home</button>
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
    const [loading, setLoading] = useState(false);
    const [stickyVisible, setStickyVisible] = useState(false);
    const profileImageRef = useRef<HTMLImageElement>(null);
    const navigate = useNavigate();

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
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-info artist-page-info-icon" onClick={showInfoPopup}>
                        <circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>
                    </svg>
                </div>
            </div>
            <div className={`artist-page-header ${!data.genius_banner ? 'no-banner' : ''}`}>
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-info artist-page-info-icon" onClick={showInfoPopup}>
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
                        <img className="emoji-flag" draggable={false} src={twemojiFlagURL(data.country)} alt="flag" />
                        {getCountryName(data.country)}
                    </p>
                </div>
            </div>
            <div className={`artist-page-content ${!data.genius_banner ? 'no-banner' : ''}`}>
                <div className="artist-page-content-item">
                    <h2 className="artist-page-title">About {data.name}</h2>
                    <div className="artist-page-info-items">
                        {data.active_from &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">Active From</p>
                            <p className="artist-page-info-item-value">{data.active_from || 'Unknown'}</p>
                        </div>
                        }
                        {data.active_until &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">Active Until</p>
                            <p className="artist-page-info-item-value">{data.active_until || 'Unknown'}</p>
                        </div>
                        }
                    </div>
                    <p className="artist-page-info-item-key artist-page-genres-key">Genres</p>
                    <div className="artist-page-info-genres">
                        {data.genres?.map((genre: string, i: number) => <p key={i} className="artist-page-info-genre">{genre}</p>)}
                    </div>
                    <p className="artist-page-info-item-key artist-page-bio-key">Bio</p>
                    <p className="artist-page-bio artist-page-info-item-value">{data.bio || 'No bio found'}</p>
                </div>
                <div className="artist-page-content-item">
                    <h2 className="artist-page-title">Releases</h2>
                    {(['Album', 'EP', 'Single'] as const).map(type => {
                        const filtered = data.releases
                            ?.filter((r: any) => r.type === type)
                            .sort((a: any, b: any) => (b.year ?? 0) - (a.year ?? 0));
                        if (!filtered?.length) return null;
                        return (
                            <div key={type}>
                                <h3 className="artist-page-releases-subtitle">{type}s</h3>
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
                                                alt={release.title || 'Unknown'}
                                                onError={(e) => { (e.currentTarget as HTMLImageElement).src = unknownArtwork; }}
                                            />
                                            <div className="artist-page-release-info">
                                                <p className="artist-page-release-name">{release.title || 'Unknown Album'}</p>
                                                <p className="artist-page-release-date">{release.year || 'Unknown Year'}</p>
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
                        Request took <strong>{data.client_time || 0} ms</strong> ({data.elapsed_ms || 0} ms on server) with {data.from_cache ? <strong>cached response</strong> : <strong>fresh response</strong>}. The expected accuracy of getting the correct artist is <strong>{((data.accuracy || 0) * 100).toFixed(2)}%</strong> ({data.accuracy || 0}).
                    </p>
                </div>
            </div>
            </>)}
        </div>
    );
}

export default ArtistPage