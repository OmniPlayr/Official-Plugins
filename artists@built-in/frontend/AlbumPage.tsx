import { useParams } from 'react-router-dom';
import { albumCache } from './albumCache';
import { useEffect, useState, useRef, Fragment } from 'react';
import unknownArtwork from '../../assets/images/unknown-art.svg';
import { ArrowBigLeft, Clock } from 'lucide-react';
import translations from './translations';
import TranslatedRichText from './TranslatedRichText';

import {
    navigate,
    api
} from '@omniplayr/plugins';

async function getAlbum(artist: string, song?: string, album?: string, type?: string) {
    if (albumCache.has(album + "_" + artist)) {
        const cached = albumCache.get(album + "_" + artist);
        return { ...cached, client_time: 0 };
    }
    const start = performance.now();
    const params = new URLSearchParams({
        ...(song ? { song } : {}),
        ...(artist ? { artist } : {}),
        ...(type ? { type } : {}),
    });
    const query = params.size ? `?${params}` : '';
    const res = await api(`/plugin/album/${encodeURIComponent(album || '')}${query}`) as any;
    const end = performance.now();
    albumCache.set(album + "_" + artist, res);
    return { ...res, client_time: +(end - start).toFixed(2) };
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

function AlbumPage() {
    const { artist } = useParams<{ artist: string }>();
    const { album } = useParams<{ album: string }>();
    const [data, setData] = useState<any>(null);
    const [notFound, setNotFound] = useState(false);
    const [missingToken, setMissingToken] = useState(false);
    const [loading, setLoading] = useState(false);
    const [stickyVisible, setStickyVisible] = useState(false);
    const profileImageRef = useRef<HTMLImageElement>(null);
    const { t } = translations.useTranslation();

    const estimatedMs = (() => {
        if (album && artist && albumCache.has(album + "_" + artist)) return 0;
        const last = Number(sessionStorage.getItem('album-last-duration') || FALLBACK_DURATION);
        return last || FALLBACK_DURATION;
    })();

    const progress = useLoadingProgress(loading, estimatedMs);

    useEffect(() => {
        if (!artist || !album) return;
        setData(null);
        setNotFound(false);
        setMissingToken(false);
        setLoading(true);
        const ctx = JSON.parse(sessionStorage.getItem('artist-nav-context') || '{}');
        sessionStorage.removeItem('artist-nav-context');
        getAlbum(artist, ctx.song, album, ctx.type).then(fetched => {
            if (fetched?.client_time) {
                sessionStorage.setItem('album-last-duration', String(fetched.client_time));
            }
            if (!fetched || !fetched.title) {
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
    }, [artist, album]);

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

    if (missingToken) {
        return (
            <div className="artist-page not-found">
                <h1 className="not-found-title">{t('missing_token.title')}</h1>
                <p className="not-found-text">{t('missing_token.text')}</p>
                <button className="not-found-button" onClick={() => window.location.href = '/settings/plugins'}>{t('missing_token.button')}</button>
            </div>
        );
    }

    if (notFound) return <div className="artist-page not-found"><h1>{t('not_found.release_title')}</h1></div>;

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
                    <button data-type="secondary" className="artist-page-back-button" onClick={() => navigate(`/artist/${encodeURIComponent(artist || '')}`)}><ArrowBigLeft />{t('album.back', { artist: data.artist })}</button>
                    <img
                        className="artist-sticky-image"
                        src={data.cover_art || unknownArtwork}
                        alt={data.title}
                        draggable={false}
                    />
                    <p className="artist-sticky-name">{data.title}</p>
                </div>
            </div>
            <button data-type="secondary" className="artist-page-back-button" onClick={() => navigate(`/artist/${encodeURIComponent(artist || '')}`)}><ArrowBigLeft />{t('album.back', { artist: data.artist })}</button>
            <div className="artist-page-header no-banner">
                <img
                    ref={profileImageRef}
                    className="artist-page-image lower-radius"
                    draggable={false}
                    src={data.cover_art || unknownArtwork}
                    alt={data.title}
                />
                <div className="artist-page-info">
                    <p className="artist-page-name">{data.title}</p>
                    <p className="artist-page-artist">{data.artist}</p>
                </div>
            </div>
            <div className="artist-page-content no-banner">
                <div className="artist-page-content-item">
                    <h2 className="artist-page-title">{t('section.about', { name: data.title })}</h2>
                    <div className="artist-page-info-items">
                        {data.release_date &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">{t('field.release_date')}</p>
                            <p className="artist-page-info-item-value">{data.release_date || t('field.unknown')}</p>
                        </div>
                        }
                        {data.songs &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">{t('field.tracks', { count: data.songs.length })}</p>
                            <p className="artist-page-info-item-value">{data.songs.length || t('field.unknown')}</p>
                        </div>
                        }
                        {data.type &&
                        <div className="artist-page-info-item">
                            <p className="artist-page-info-item-key">{t('field.type')}</p>
                            <p className="artist-page-info-item-value">{data.type || t('field.unknown')}</p>
                        </div>
                        }
                    </div>
                    <p className="artist-page-info-item-key artist-page-genres-key">{t('field.genres')}</p>
                    <div className="artist-page-info-genres">
                        {data.genres?.map((genre: string, i: number) => <p key={i} className="artist-page-info-genre">{genre}</p>)}
                    </div>
                </div>
                <table className="artist-page-songs-table">
                    <thead>
                        <tr className="artist-page-songs-header">
                            <th className="artist-page-song-number">#</th>
                            <th className="artist-page-song-info-title">{t('songs.title')}</th>
                            <th className="artist-page-song-duration"><Clock size={14} /></th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.songs.sort((a: any, b: any) => a.position - b.position).map((song: any) => (
                            <tr className="artist-page-song" key={song.id}>
                                <td className="artist-page-song-number">{song.position}</td>
                                <td className="artist-page-song-info">
                                    <img
                                        className="artist-page-song-image"
                                        draggable={false}
                                        src={song.cover_art || unknownArtwork}
                                        alt={song.title}
                                    />
                                    <div className="artist-page-song-t-a">
                                        <p className="artist-page-song-title">{song.title}</p>
                                        <p className="artist-page-song-artists">
                                            {song.artists?.map((artist: any, i: number) => (
                                                <Fragment key={`${i}-${artist}`}>
                                                    {i > 0 && ', '}
                                                    <span className="artist-page-song-artist" onClick={() => navigate(`/artist/${encodeURIComponent(artist)}`)}>
                                                        {artist}
                                                    </span>
                                                </Fragment>
                                            ))}
                                        </p>
                                    </div>
                                </td>
                                <td className="artist-page-song-duration">{song.length_fmt}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="artist-page-request-info">
                <p className="artist-page-request-info-text">
                    <TranslatedRichText
                        i18nKey="request.album"
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
            </>)}
        </div>
    );
}

export default AlbumPage;
