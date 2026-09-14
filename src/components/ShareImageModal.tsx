import React, { useRef, useState, useMemo, useEffect } from 'react';
import { toPng } from 'html-to-image';
import { X, Download, Loader2, Camera, Activity, Info, Calendar } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import { useFocusTrap } from '../hooks/useFocusTrap';
import {
    DoseEvent, SimulationResult, LabResult,
    interpolateConcentration_E2, interpolateCompoundConcentration, convertToPgMl,
    pickPrimaryAntiandrogen, ANTIANDROGENS, formatAntiandrogenConc, Ester,
    PERSONAL_E2_CEILING_PGML,
} from '../../logic';
import ResultChartStatic from './ResultChartStatic';
import { API_ORIGIN } from '../api/config';

interface SimCI {
    timeH: number[];
    e2Adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
    ci68Low: number[];
    ci68High: number[];
    antiandrogen: Partial<Record<string, { adjusted: number[]; ci95Low: number[]; ci95High: number[] }>>;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    events: DoseEvent[];
    labResults: LabResult[];
    simulation: SimulationResult | null;
    simCI?: SimCI | null;
    baselineE2PGmL?: number | null;
}

function interpAt(timeH: number[], values: number[], h: number): number {
    if (!timeH.length) return 0;
    if (h <= timeH[0]) return values[0];
    if (h >= timeH[timeH.length - 1]) return values[values.length - 1];
    let lo = 0, hi = timeH.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (timeH[mid] <= h) lo = mid; else hi = mid;
    }
    const frac = (timeH[hi] - timeH[lo]) > 0 ? (h - timeH[lo]) / (timeH[hi] - timeH[lo]) : 0;
    const v = values[lo] + frac * (values[hi] - values[lo]);
    return isFinite(v) ? v : 0;
}

// A4 landscape at 150dpi
const CANVAS_W = 2480;
const CANVAS_H = 1754;
const CHART_W = 2320; // CANVAS_W - 160px padding
const CHART_H = 880;

// Local-time helpers for <input type="date">
function msToDateInput(ms: number): string {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
function dateInputToMs(s: string): number {
    // Local midnight
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1).getTime();
}

function hexToRgb(hex: string): string {
    const h = hex.replace('#', '');
    const n = parseInt(h, 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

const ShareImageModal: React.FC<Props> = ({
    isOpen, onClose, events, labResults, simulation, simCI, baselineE2PGmL,
}) => {
    const { user } = useAuth();
    const { t } = useTranslation();
    const { isDark, colors } = useTheme();
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState('');
    const printRef = useRef<HTMLDivElement>(null);
    const dialogRef = useFocusTrap(isOpen, onClose);

    const now = useMemo(() => new Date(), [isOpen]); // eslint-disable-line
    const h = now.getTime() / 3600000;

    const hasPersonalModel = !!simCI && simCI.e2Adjusted.length > 0;
    // Primary anti-androgen on the right axis = most recently dosed one.
    const primaryAA: Ester | null = pickPrimaryAntiandrogen(events, h);
    const aaSpec = primaryAA ? ANTIANDROGENS[primaryAA]! : null;
    const aaUnit: 'ng/mL' | 'ug/mL' = primaryAA === Ester.BICA ? 'ug/mL' : 'ng/mL';
    const aaScale = aaUnit === 'ug/mL' ? 1 / 1000 : 1;
    const aaLabel = primaryAA ?? 'CPA';
    const aaPersonalized = !!aaSpec?.adherenceFromE2;
    const aaCISeries = (primaryAA && simCI) ? simCI.antiandrogen[primaryAA] : undefined;
    const hasPersonalCpaModel = !!aaCISeries && !!simCI && aaCISeries.adjusted.length === simCI.timeH.length && aaCISeries.adjusted.length > 0;
    const hasPersonalCpaCI = !!aaCISeries && !!simCI && aaCISeries.ci95Low.length === simCI.timeH.length;
    const hasCPADoses = !!primaryAA;
    const hasData = !!simulation && events.length > 0;
    const hasDoseHistory = events.length > 0;

    // ── Data bounds & date range ──
    const dataBounds = useMemo(() => {
        if (!simulation || simulation.timeH.length === 0) return null;
        return {
            min: simulation.timeH[0] * 3600000,
            max: simulation.timeH[simulation.timeH.length - 1] * 3600000,
        };
    }, [simulation]);

    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');

    // Initialize / reset on open ─ proper effect, not useMemo
    useEffect(() => {
        if (isOpen && dataBounds) {
            setStartDate(msToDateInput(dataBounds.min));
            setEndDate(msToDateInput(dataBounds.max));
            setError('');
        }
    }, [isOpen, dataBounds]);

    const xDomain = useMemo((): [number, number] | null => {
        if (!dataBounds) return null;
        const startMs = startDate ? dateInputToMs(startDate) : dataBounds.min;
        // End-of-day for inclusive end date
        const endMs = endDate ? dateInputToMs(endDate) + 86_400_000 - 1 : dataBounds.max;
        const start = Math.max(dataBounds.min, Math.min(startMs, dataBounds.max));
        const end = Math.min(dataBounds.max, Math.max(endMs, dataBounds.min));
        if (start >= end) return [dataBounds.min, dataBounds.max];
        return [start, end];
    }, [startDate, endDate, dataBounds]);

    const dateRangeInvalid = !!startDate && !!endDate && dateInputToMs(startDate) > dateInputToMs(endDate);

    // ── Quick presets ──
    const setPreset = (days: number | 'all') => {
        if (!dataBounds) return;
        if (days === 'all') {
            setStartDate(msToDateInput(dataBounds.min));
            setEndDate(msToDateInput(dataBounds.max));
            return;
        }
        const end = Math.min(dataBounds.max, now.getTime());
        const start = Math.max(dataBounds.min, end - days * 86_400_000);
        setStartDate(msToDateInput(start));
        setEndDate(msToDateInput(end));
    };

    // ── Current values (mirror OverviewView logic) ──
    const rawE2 = simulation ? (interpolateConcentration_E2(simulation, h) || 0) : 0;
    const baseShift = (!hasPersonalModel && baselineE2PGmL && baselineE2PGmL > 0) ? baselineE2PGmL : 0;
    // F13 final-review fix: a personal estimate at the model ceiling stays
    // sourced from the personal curve (rendered with a "≥" qualifier), never
    // silently swapped for the raw population value while the CI stays personal.
    const personalE2Raw = hasPersonalModel ? interpAt(simCI!.timeH, simCI!.e2Adjusted, h) : null;
    const personalE2Capped = personalE2Raw !== null && personalE2Raw >= PERSONAL_E2_CEILING_PGML;
    const currentE2 = personalE2Raw !== null ? personalE2Raw : (rawE2 + baseShift);

    const rawCPA = (simulation && primaryAA) ? (interpolateCompoundConcentration(simulation, primaryAA, h) || 0) * aaScale : 0;
    const personalCPA = (hasPersonalCpaModel && aaCISeries) ? interpAt(simCI!.timeH, aaCISeries.adjusted, h) * aaScale : null;
    const currentCPA = personalCPA ?? rawCPA;

    const currentCI = hasPersonalModel ? (() => {
        const lo = interpAt(simCI!.timeH, simCI!.ci95Low, h);
        const hi = interpAt(simCI!.timeH, simCI!.ci95High, h);
        return (lo > 0 && hi > lo) ? { lo, hi } : null;
    })() : null;

    const currentCPACI = (hasPersonalCpaModel && hasPersonalCpaCI && aaCISeries) ? (() => {
        const lo = interpAt(simCI!.timeH, aaCISeries.ci95Low, h) * aaScale;
        const hi = interpAt(simCI!.timeH, aaCISeries.ci95High, h) * aaScale;
        return (lo > 0 && hi > lo) ? { lo, hi } : null;
    })() : null;

    const currentCI68 = (hasPersonalModel && simCI!.ci68Low?.length === simCI!.timeH.length) ? (() => {
        const lo = interpAt(simCI!.timeH, simCI!.ci68Low, h);
        const hi = interpAt(simCI!.timeH, simCI!.ci68High, h);
        return (lo > 0 && hi > lo) ? { lo, hi } : null;
    })() : null;

    // Baseline (lab-result-only fallback)
    const baselineLevel = useMemo(() => {
        if (!hasDoseHistory && labResults.length > 0) {
            const latest = [...labResults].sort((a, b) => b.timeH - a.timeH)[0];
            const v = convertToPgMl(latest.concValue, latest.unit);
            return isFinite(v) && v > 0 ? v : null;
        }
        return null;
    }, [hasDoseHistory, labResults]);

    // ── User info (only if logged in) ──
    const isLoggedIn = !!user;
    const displayName = isLoggedIn ? (user!.displayName || user!.username || '') : '';
    const candidateAvatarSrc = isLoggedIn
        ? (user!.avatarUrl || (user!.username ? `${API_ORIGIN}/api/avatars/${user!.username}` : null))
        : null;

    // Pre-fetch images as data URLs so html-to-image can embed them without any CORS issues.
    // The browser caches /favicon.ico and OAuth avatars without CORS headers during normal
    // page load, causing crossOrigin="anonymous" img elements to hit "tainted canvas" errors.
    // Fetching via the Fetch API uses a separate CORS cache and returns a blob we can
    // convert to a data URL — html-to-image embeds data URLs directly, no re-fetch needed.
    const [avatarSrc, setAvatarSrc] = useState<string | null>(null);
    useEffect(() => {
        if (!candidateAvatarSrc) { setAvatarSrc(null); return; }
        let cancelled = false;
        const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        fetch(candidateAvatarSrc, { mode: 'cors', cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error('http'); return r.blob(); })
            .then(blobToDataUrl)
            .then(dataUrl => { if (!cancelled) setAvatarSrc(dataUrl); })
            .catch(() => { if (!cancelled) setAvatarSrc(null); }); // CORS not supported → letter placeholder
        return () => { cancelled = true; };
    }, [candidateAvatarSrc]);

    // Favicon: same-origin fetch always succeeds; converts to data URL to avoid the
    // browser's non-CORS favicon cache poisoning html-to-image's canvas serialisation.
    const [faviconSrc, setFaviconSrc] = useState<string | null>(null);
    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        fetch('/favicon.ico', { cache: 'no-store' })
            .then(r => { if (!r.ok) throw new Error('http'); return r.blob(); })
            .then(blob => new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            }))
            .then(dataUrl => { if (!cancelled) setFaviconSrc(dataUrl); })
            .catch(() => { if (!cancelled) setFaviconSrc('/favicon.ico'); });
        return () => { cancelled = true; };
    }, [isOpen]);

    // ── Theme-aware print canvas palette (mirrors index.css custom properties) ──
    const accent50 = colors[50];
    const accent200 = colors[200];
    const accent300 = colors[300];
    const accent400 = colors[400];
    const accent500 = colors[500];
    const accent600 = colors[600];
    const accentRgb = hexToRgb(accent500);

    const palette = isDark ? {
        bg: '#0b1220',
        bgCard: '#111827',
        bgCardHover: '#1f2937',
        textPrimary: '#f1f5f9',
        textSecondary: '#cbd5e1',
        textTertiary: '#94a3b8',
        border: '#1f2937',
        borderSoft: '#243042',
        cardGradient: `linear-gradient(135deg, rgba(${accentRgb},0.18), #111827 70%)`,
    } : {
        bg: '#fafbff',
        bgCard: '#ffffff',
        bgCardHover: '#f1f5f9',
        textPrimary: '#0f172a',
        textSecondary: '#475569',
        textTertiary: '#94a3b8',
        border: '#e2e8f0',
        borderSoft: '#eef2f7',
        cardGradient: `linear-gradient(135deg, rgba(${accentRgb},0.08), #ffffff 70%)`,
    };

    // Anti-androgen accent (per-compound: CPA purple, bicalutamide amber)
    const cpaPrimary = aaSpec?.color ?? (isDark ? '#c084fc' : '#9333ea');
    const cpaSoft = aaSpec ? aaSpec.color : (isDark ? '#a78bfa' : '#d8b4fe');

    // ── Status badge logic (identical to OverviewView) ──
    const getLevelStatus = (conc: number) => {
        if (conc > 300) return { label: 'status.level.high', color: isDark ? '#fb7185' : '#e11d48', bg: isDark ? 'rgba(225,29,72,0.18)' : '#fff1f2', border: isDark ? 'rgba(225,29,72,0.35)' : '#fecdd3' };
        if (conc >= 100 && conc <= 200) return { label: 'status.level.mtf', color: isDark ? '#34d399' : '#059669', bg: isDark ? 'rgba(5,150,105,0.18)' : '#ecfdf5', border: isDark ? 'rgba(5,150,105,0.35)' : '#a7f3d0' };
        if (conc >= 70 && conc <= 300) return { label: 'status.level.luteal', color: isDark ? '#60a5fa' : '#2563eb', bg: isDark ? 'rgba(37,99,235,0.18)' : '#eff6ff', border: isDark ? 'rgba(37,99,235,0.35)' : '#bfdbfe' };
        if (conc >= 30 && conc < 70) return { label: 'status.level.follicular', color: isDark ? '#818cf8' : '#4f46e5', bg: isDark ? 'rgba(79,70,229,0.18)' : '#eef2ff', border: isDark ? 'rgba(79,70,229,0.35)' : '#c7d2fe' };
        if (conc >= 8 && conc < 30) return { label: 'status.level.male', color: palette.textSecondary, bg: palette.bgCardHover, border: palette.border };
        return { label: 'status.level.low', color: isDark ? '#fbbf24' : '#d97706', bg: isDark ? 'rgba(217,119,6,0.18)' : '#fffbeb', border: isDark ? 'rgba(217,119,6,0.35)' : '#fde68a' };
    };
    const e2Status = currentE2 > 0 ? getLevelStatus(currentE2) : null;

    // ── Number formatters ──
    const fmtE2 = (v: number) => v >= 100 ? v.toFixed(0) : v.toFixed(1);
    const fmtCPA = (v: number) => v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);

    const handleDownload = async () => {
        if (!printRef.current) return;
        setGenerating(true);
        setError('');
        try {
            const dataUrl = await toPng(printRef.current, {
                cacheBust: true,
                pixelRatio: 1,
                backgroundColor: palette.bg,
                width: CANVAS_W,
                height: CANVAS_H,
                // If any image (e.g. avatar) fails to load during capture, substitute
                // a 1x1 transparent pixel instead of rejecting the whole render.
                imagePlaceholder:
                    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
            });
            const link = document.createElement('a');
            link.download = `hrt-share-${now.toISOString().slice(0, 10)}.png`;
            link.href = dataUrl;
            link.click();
        } catch (err) {
            console.error('Failed to generate image:', err);
            setError(t('share.error') || 'Failed to generate image. Please try again.');
        } finally {
            setGenerating(false);
        }
    };

    if (!isOpen) return null;

    // ── Modal UI ──
    return (
        <div
            className="fixed inset-0 flex items-center justify-center z-50 animate-in fade-in duration-200"
            style={{ background: 'var(--bg-overlay)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="share-image-modal-title"
                className="rounded-3xl w-full max-w-2xl p-6 md:p-8 flex flex-col gap-5 modal-spring-glass safe-area-pb glass-modal"
            >
                {/* Header */}
                <div className="flex justify-between items-center shrink-0">
                    <h3 id="share-image-modal-title" className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        <Camera size={20} style={{ color: accent500 }} />
                        {t('share.imageTitle') || 'Export as Image'}
                    </h3>
                    <button onClick={onClose} aria-label={t('btn.close')} className="p-2 rounded-full transition" style={{ background: 'var(--bg-card-hover)' }}>
                        <X size={20} style={{ color: 'var(--text-secondary)' }} />
                    </button>
                </div>

                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    {t('share.imageDesc') || 'Generates a high-resolution landscape image with current levels and full chart.'}
                </p>

                {/* Date range card */}
                <div className="rounded-2xl p-4 flex flex-col gap-3"
                    style={{ background: 'var(--bg-card-hover)', border: '1px solid var(--border-primary)' }}>
                    <div className="flex items-center gap-2">
                        <Calendar size={16} style={{ color: accent500 }} />
                        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                            {t('share.rangeLabel') || 'Chart date range'}
                        </span>
                    </div>

                    {/* Manual date inputs */}
                    <div className="flex gap-3 items-end flex-wrap">
                        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
                            <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                                {t('share.rangeFrom') || 'From'}
                            </label>
                            <input
                                type="date"
                                value={startDate}
                                onChange={e => setStartDate(e.target.value)}
                                min={dataBounds ? msToDateInput(dataBounds.min) : undefined}
                                max={dataBounds ? msToDateInput(dataBounds.max) : undefined}
                                className="rounded-lg px-3 py-2 text-sm font-medium outline-none transition"
                                style={{
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-primary)',
                                    border: `1px solid ${dateRangeInvalid ? '#ef4444' : 'var(--border-primary)'}`,
                                    colorScheme: isDark ? 'dark' : 'light',
                                }}
                            />
                        </div>
                        <div className="flex flex-col gap-1 flex-1 min-w-[140px]">
                            <label className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>
                                {t('share.rangeTo') || 'To'}
                            </label>
                            <input
                                type="date"
                                value={endDate}
                                onChange={e => setEndDate(e.target.value)}
                                min={dataBounds ? msToDateInput(dataBounds.min) : undefined}
                                max={dataBounds ? msToDateInput(dataBounds.max) : undefined}
                                className="rounded-lg px-3 py-2 text-sm font-medium outline-none transition"
                                style={{
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-primary)',
                                    border: `1px solid ${dateRangeInvalid ? '#ef4444' : 'var(--border-primary)'}`,
                                    colorScheme: isDark ? 'dark' : 'light',
                                }}
                            />
                        </div>
                    </div>

                    {/* Quick presets */}
                    <div className="flex gap-2 flex-wrap">
                        {[
                            { key: 7, label: t('share.range7d') || 'Last 7d' },
                            { key: 30, label: t('share.range30d') || 'Last 30d' },
                            { key: 90, label: t('share.range90d') || 'Last 90d' },
                            { key: 'all' as const, label: t('share.rangeAll') || 'All' },
                        ].map(p => (
                            <button
                                key={String(p.key)}
                                onClick={() => setPreset(p.key)}
                                className="px-2.5 py-1 rounded-md text-xs font-semibold transition btn-press-glass"
                                style={{
                                    background: 'var(--bg-card)',
                                    color: 'var(--text-secondary)',
                                    border: '1px solid var(--border-primary)',
                                }}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>

                    {dateRangeInvalid && (
                        <p className="text-xs text-red-500">{t('share.rangeInvalid') || 'Start date must be before end date.'}</p>
                    )}
                </div>

                {error && (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
                )}

                <button
                    onClick={handleDownload}
                    disabled={generating || !hasData || dateRangeInvalid}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-white font-bold transition glass-btn-primary btn-press-glass disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    {generating ? (
                        <><Loader2 size={18} className="animate-spin" /> {t('share.generating') || 'Generating...'}</>
                    ) : (
                        <><Download size={18} /> {t('share.download') || 'Download Image'}</>
                    )}
                </button>

                {!hasData && (
                    <p className="text-center text-sm" style={{ color: 'var(--text-tertiary)' }}>
                        {t('share.noData') || 'No data to export'}
                    </p>
                )}
            </div>

            {/* ─────────────────────────────────────────────────────────── */}
            {/* Off-screen print canvas — mirrors OverviewView visual design  */}
            {/* ─────────────────────────────────────────────────────────── */}
            <div
                aria-hidden="true"
                style={{
                    position: 'fixed',
                    top: 0,
                    left: '-9999px',
                    width: `${CANVAS_W}px`,
                    height: `${CANVAS_H}px`,
                    overflow: 'hidden',
                    background: palette.bg,
                    pointerEvents: 'none',
                    zIndex: -1,
                }}
            >
                <div ref={printRef} style={{
                    width: `${CANVAS_W}px`,
                    height: `${CANVAS_H}px`,
                    background: palette.bg,
                    display: 'flex',
                    flexDirection: 'column',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                    padding: '56px 72px 40px',
                    boxSizing: 'border-box',
                    gap: '28px',
                    color: palette.textPrimary,
                }}>
                    {/* ── Top brand bar: user info + app title + date ── */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '24px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                            {isLoggedIn && avatarSrc && (
                                <img
                                    src={avatarSrc}
                                    alt=""
                                    style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', border: `4px solid ${accent300}`, flexShrink: 0 }}
                                />
                            )}
                            {isLoggedIn && !avatarSrc && (
                                <div style={{
                                    width: '96px', height: '96px', borderRadius: '50%',
                                    background: accent50, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    border: `4px solid ${accent200}`, flexShrink: 0,
                                }}>
                                    <span style={{ fontSize: '44px', color: accent600, fontWeight: 900, lineHeight: 1 }}>
                                        {displayName[0]?.toUpperCase() || '?'}
                                    </span>
                                </div>
                            )}
                            <div style={{ whiteSpace: 'nowrap' }}>
                                {isLoggedIn && displayName && (
                                    <div style={{ fontSize: '40px', fontWeight: 800, color: palette.textPrimary, lineHeight: 1.15, letterSpacing: '-0.02em' }}>
                                        {displayName}
                                    </div>
                                )}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '12px',
                                    marginTop: isLoggedIn && displayName ? '8px' : '0',
                                }}>
                                    {faviconSrc && (
                                        <img
                                            src={faviconSrc}
                                            alt=""
                                            style={{ width: '36px', height: '36px', flexShrink: 0, borderRadius: '8px' }}
                                        />
                                    )}
                                    <div style={{
                                        fontSize: '28px',
                                        color: palette.textPrimary,
                                        fontWeight: 800,
                                        letterSpacing: '-0.01em',
                                    }}>
                                        Transmtf HRT Tracker
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <div style={{ fontSize: '30px', color: palette.textPrimary, fontWeight: 800, letterSpacing: '-0.01em' }}>
                                {now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
                            </div>
                            <div style={{ fontSize: '22px', color: palette.textTertiary, marginTop: '6px', fontWeight: 600 }}>
                                {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                            </div>
                        </div>
                    </div>

                    {/* ── Main level card (mirrors OverviewView's glass-card) ── */}
                    <div style={{
                        background: palette.cardGradient,
                        border: `1px solid ${palette.border}`,
                        borderRadius: '28px',
                        padding: '32px 44px',
                        flexShrink: 0,
                        boxShadow: isDark ? '0 1px 0 rgba(255,255,255,0.04) inset' : '0 1px 2px rgba(15,23,42,0.04)',
                    }}>
                        {/* Status pill */}
                        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '18px' }}>
                            <div style={{
                                display: 'inline-flex', alignItems: 'center', gap: '10px',
                                padding: '8px 18px', borderRadius: '999px',
                                background: palette.bgCard, color: palette.textSecondary,
                                border: `1px solid ${palette.border}`,
                                fontSize: '17px', fontWeight: 700,
                                whiteSpace: 'nowrap',
                            }}>
                                <Activity size={18} style={{ color: palette.textTertiary, flexShrink: 0 }} />
                                <span style={{ whiteSpace: 'nowrap' }}>
                                    {t('status.estimate') || 'Current estimated concentration'}
                                </span>
                                {hasPersonalModel && (
                                    <span style={{
                                        marginLeft: '4px', padding: '3px 10px', borderRadius: '999px',
                                        background: accent50, color: accent600,
                                        border: `1px solid ${accent200}`,
                                        fontSize: '13px', fontWeight: 800,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        {t('chart.personal_model') || 'Personal Model'}
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* Two-column E2 / CPA */}
                        <div style={{ display: 'grid', gridTemplateColumns: hasCPADoses ? '1fr 1fr' : '1fr', gap: '48px' }}>
                            {/* E2 */}
                            <div>
                                <div style={{ fontSize: '16px', fontWeight: 800, color: accent400, textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '8px' }}>
                                    E2
                                </div>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', whiteSpace: 'nowrap' }}>
                                    {currentE2 > 0 || baselineLevel ? (
                                        <>
                                            <span style={{ fontSize: '110px', fontWeight: 900, color: accent500, lineHeight: 0.9, letterSpacing: '-0.03em' }}>
                                                {personalE2Capped && <span style={{ fontSize: '60px', color: accent300 }}>≥ </span>}
                                                {fmtE2(currentE2 > 0 ? currentE2 : baselineLevel!)}
                                            </span>
                                            <span style={{ fontSize: '26px', fontWeight: 800, color: accent300, marginBottom: '14px' }}>pg/mL</span>
                                        </>
                                    ) : (
                                        <span style={{ fontSize: '110px', fontWeight: 900, color: palette.textTertiary, lineHeight: 0.9 }}>--</span>
                                    )}
                                </div>

                                {/* Supporting lines */}
                                <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {currentCI && (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: accent300, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('chart.ci_band')}</span>
                                            <span style={{ fontSize: '18px', fontWeight: 700, color: accent500 }}>
                                                {currentCI.lo.toFixed(0)} – {currentCI.hi.toFixed(0)}
                                                <span style={{ fontSize: '13px', fontWeight: 500, marginLeft: '6px', color: accent300 }}>pg/mL</span>
                                            </span>
                                        </div>
                                    )}
                                    {currentCI68 && (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: accent300, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('chart.ci68_band')}</span>
                                            <span style={{ fontSize: '18px', fontWeight: 700, color: accent500 }}>
                                                {currentCI68.lo.toFixed(0)} – {currentCI68.hi.toFixed(0)}
                                                <span style={{ fontSize: '13px', fontWeight: 500, marginLeft: '6px', color: accent300 }}>pg/mL</span>
                                            </span>
                                        </div>
                                    )}
                                    {personalE2Raw !== null && (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: accent300, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                                {t('chart.personal_model') || 'Personal'}
                                            </span>
                                            <span style={{ fontSize: '17px', fontWeight: 700, color: accent500 }}>
                                                {personalE2Capped && '≥ '}{personalE2Raw.toFixed(1)} pg/mL
                                            </span>
                                        </div>
                                    )}
                                    {hasPersonalModel && rawE2 > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: palette.textTertiary, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Raw</span>
                                            <span style={{ fontSize: '17px', fontWeight: 700, color: palette.textSecondary }}>
                                                {rawE2.toFixed(1)} pg/mL
                                            </span>
                                        </div>
                                    )}
                                    {!hasDoseHistory && baselineLevel !== null && (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#2dd4bf', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Baseline</span>
                                            <span style={{ fontSize: '17px', fontWeight: 700, color: '#14b8a6' }}>{baselineLevel.toFixed(1)} pg/mL</span>
                                        </div>
                                    )}
                                    {hasDoseHistory && !hasPersonalModel && baselineE2PGmL != null && baselineE2PGmL > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 800, color: '#2dd4bf', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Endogenous</span>
                                            <span style={{ fontSize: '17px', fontWeight: 700, color: '#14b8a6' }}>{baselineE2PGmL.toFixed(1)} pg/mL</span>
                                        </div>
                                    )}
                                </div>

                                {/* Status badge */}
                                {e2Status && currentE2 > 0 && (
                                    <div style={{
                                        display: 'inline-flex', alignItems: 'center', gap: '10px',
                                        marginTop: '16px', padding: '10px 18px',
                                        borderRadius: '14px',
                                        background: e2Status.bg, border: `1px solid ${e2Status.border}`,
                                        whiteSpace: 'nowrap',
                                    }}>
                                        <Info size={16} style={{ color: e2Status.color, flexShrink: 0 }} />
                                        <span style={{ fontSize: '15px', fontWeight: 800, color: e2Status.color }}>
                                            {t(e2Status.label)}
                                        </span>
                                    </div>
                                )}
                            </div>

                            {/* CPA */}
                            {hasCPADoses && (
                                <div>
                                    <div style={{ fontSize: '16px', fontWeight: 800, color: cpaPrimary, textTransform: 'uppercase', letterSpacing: '0.2em', marginBottom: '8px' }}>
                                        {aaLabel}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '12px', whiteSpace: 'nowrap' }}>
                                        {currentCPA > 0 ? (
                                            <>
                                                <span style={{ fontSize: '110px', fontWeight: 900, color: cpaPrimary, lineHeight: 0.9, letterSpacing: '-0.03em' }}>
                                                    {fmtCPA(currentCPA)}
                                                </span>
                                                <span style={{ fontSize: '26px', fontWeight: 800, color: cpaSoft, marginBottom: '14px' }}>{aaUnit}</span>
                                            </>
                                        ) : (
                                            <span style={{ fontSize: '110px', fontWeight: 900, color: palette.textTertiary, lineHeight: 0.9 }}>--</span>
                                        )}
                                    </div>

                                    {hasPersonalCpaModel && currentCPA > 0 && (
                                        <div style={{ marginTop: '14px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {currentCPACI && (
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                                    <span style={{ fontSize: '13px', fontWeight: 800, color: cpaSoft, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                                        {t('chart.ci_band')}
                                                    </span>
                                                    <span style={{ fontSize: '18px', fontWeight: 700, color: cpaPrimary }}>
                                                        {currentCPACI.lo.toFixed(2)} – {currentCPACI.hi.toFixed(2)}
                                                        <span style={{ fontSize: '13px', fontWeight: 500, marginLeft: '6px', color: cpaSoft }}>{aaUnit}</span>
                                                    </span>
                                                </div>
                                            )}
                                            {personalCPA !== null && aaPersonalized && (
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                                    <span style={{ fontSize: '13px', fontWeight: 800, color: cpaSoft, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                                                        Personal
                                                    </span>
                                                    <span style={{ fontSize: '17px', fontWeight: 700, color: cpaPrimary }}>{personalCPA.toFixed(2)} {aaUnit}</span>
                                                </div>
                                            )}
                                            {rawCPA > 0 && rawCPA !== personalCPA && (
                                                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', whiteSpace: 'nowrap' }}>
                                                    <span style={{ fontSize: '13px', fontWeight: 800, color: palette.textTertiary, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Base</span>
                                                    <span style={{ fontSize: '17px', fontWeight: 700, color: palette.textSecondary }}>{rawCPA.toFixed(2)} {aaUnit}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Chart area ── */}
                    <div style={{
                        flex: 1,
                        minHeight: 0,
                        background: palette.bgCard,
                        border: `1px solid ${palette.border}`,
                        borderRadius: '28px',
                        padding: '24px 20px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                    }}>
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '0 16px 12px', flexShrink: 0,
                        }}>
                            <div style={{ fontSize: '18px', fontWeight: 800, color: palette.textSecondary, letterSpacing: '0.02em' }}>
                                {t('chart.title') || 'Concentration'}
                            </div>
                            {xDomain && (
                                <div style={{ fontSize: '15px', fontWeight: 600, color: palette.textTertiary, whiteSpace: 'nowrap' }}>
                                    {new Date(xDomain[0]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                    {'  —  '}
                                    {new Date(xDomain[1]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                </div>
                            )}
                        </div>
                        <div style={{ flex: 1, minHeight: 0 }}>
                            <ResultChartStatic
                                sim={simulation}
                                events={events}
                                labResults={labResults}
                                simCI={simCI}
                                baselineE2PGmL={baselineE2PGmL}
                                xDomain={xDomain}
                                nowH={h}
                                width={CHART_W}
                                height={CHART_H}
                                isDark={isDark}
                                themeColors={colors}
                            />
                        </div>
                    </div>

                    {/* ── Footer ── */}
                    <div style={{
                        flexShrink: 0,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingTop: '4px',
                    }}>
                        <div style={{ fontSize: '15px', color: palette.textTertiary, fontWeight: 600 }}>
                            Powered by Transmtf
                        </div>
                        <div style={{ fontSize: '15px', color: accent500, fontWeight: 800, letterSpacing: '0.04em' }}>
                            🌸 hrt.transmtf.com
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ShareImageModal;
