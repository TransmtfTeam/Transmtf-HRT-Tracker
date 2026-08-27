import React, { useMemo, useState, useRef, useLayoutEffect } from 'react';
import { Activity, Info, Camera, Syringe, Pill, Droplet, Sticker, Plus } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useTheme } from '../contexts/ThemeContext';
import ResultChart from '../components/ResultChart';
import ShareImageModal from '../components/ShareImageModal';
import { formatTime } from '../utils/helpers';
import { DoseEvent, SimulationResult, LabResult, Route, Ester, ExtraKey, SL_TIER_ORDER, interpolateConcentration_E2, interpolateCompoundConcentration, isAntiandrogen, pickPrimaryAntiandrogen, ANTIANDROGENS, formatAntiandrogenConc, convertToPgMl } from '../../logic';

/** Convert hex color string to "r,g,b" for use in rgba() */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

/**
 * Auto-fit font size, measured against the actually-rendered DOM (not a
 * canvas) so the natural width always matches the displayed glyph metrics —
 * canvas measurement diverges from CSS font-stack rendering across devices
 * and tripped the home page after route remounts. The hook returns refs for
 * both the visible container and an invisible measuring sibling that the
 * consumer renders at `maxPx`. Re-runs on:
 *  - mount (initial sync layout phase)
 *  - the next two animation frames (post-CSS-animation settling)
 *  - 100ms and 300ms after mount (defensive, covers the 250ms fadeSlideIn)
 *  - `document.fonts.ready` (font swap)
 *  - ResizeObserver on the container, the measuring element, AND the
 *    documentElement (orientation / viewport changes)
 *  - `window.resize` and `orientationchange` events
 */
function useAutoFitFontSize(
  text: string,
  maxPx: number,
  minPx: number,
  fitRatio: number = 0.88,
): {
  containerRef: React.RefObject<HTMLDivElement>;
  measureRef: React.RefObject<HTMLSpanElement>;
  fontSize: number;
  letterSpacing: number;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [sizing, setSizing] = useState<{ fontSize: number; letterSpacing: number }>(
    { fontSize: minPx, letterSpacing: 0 },
  );

  useLayoutEffect(() => {
    const el = containerRef.current;
    const m = measureRef.current;
    if (!el || !m) return;

    const apply = (next: { fontSize: number; letterSpacing: number }) => {
      setSizing(prev => (
        prev.fontSize === next.fontSize && Math.abs(prev.letterSpacing - next.letterSpacing) < 0.01
          ? prev
          : next
      ));
    };

    let rafPending = false;

    const measureNow = () => {
      rafPending = false;
      const containerWidth = Math.floor(el.getBoundingClientRect().width);
      const naturalWidth = Math.ceil(
        Math.max(m.scrollWidth, m.offsetWidth, m.getBoundingClientRect().width),
      );
      // Skip until both the container and the hidden measuring sibling have
      // valid sizes — otherwise we'd clobber a previous good measurement
      // mid-route-transition with a transient 0.
      if (containerWidth <= 0 || naturalWidth <= 0 || text.length === 0) return;
      if (naturalWidth <= containerWidth) {
        apply({ fontSize: maxPx, letterSpacing: 0 });
        return;
      }
      const availableWidth = Math.max(1, (containerWidth - 2) * fitRatio);
      const scaled = Math.floor(maxPx * (availableWidth / naturalWidth) * 0.98);
      if (scaled >= minPx) {
        apply({ fontSize: scaled, letterSpacing: 0 });
        return;
      }
      // Below minPx: clamp font and tighten letter-spacing across the gaps.
      // Monospace width scales linearly with font size, so we can derive the
      // width at minPx directly from the maxPx measurement.
      const widthAtMin = naturalWidth * (minPx / maxPx);
      const overshoot = widthAtMin - availableWidth;
      const gaps = Math.max(1, text.length - 1);
      const tightening = overshoot > 0 ? -(overshoot / gaps) - 0.1 : 0;
      apply({ fontSize: minPx, letterSpacing: tightening });
    };

    const rafIds: number[] = [];

    const measure = () => {
      if (rafPending) return;
      rafPending = true;
      rafIds.push(requestAnimationFrame(measureNow));
    };

    const cleanups: Array<() => void> = [];

    measureNow();

    rafIds.push(requestAnimationFrame(() => {
      measureNow();
      rafIds.push(requestAnimationFrame(measureNow));
    }));
    cleanups.push(() => rafIds.forEach(cancelAnimationFrame));

    const timeouts = [50, 100, 250, 300, 600, 1000].map(delay => setTimeout(measure, delay));
    cleanups.push(() => timeouts.forEach(clearTimeout));

    const fonts = (document as Document & { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      let alive = true;
      fonts.ready.then(() => { if (alive) measure(); }).catch(() => { /* ignore */ });
      cleanups.push(() => { alive = false; });
    }

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      ro.observe(m);
      if (el.parentElement) ro.observe(el.parentElement);
      cleanups.push(() => ro.disconnect());
      const docRo = new ResizeObserver(measure);
      docRo.observe(document.documentElement);
      cleanups.push(() => docRo.disconnect());
    }

    const onResize = () => measure();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    window.visualViewport?.addEventListener('resize', onResize, { passive: true });
    window.visualViewport?.addEventListener('scroll', onResize, { passive: true });
    window.addEventListener('pageshow', onResize);
    document.addEventListener('animationend', onResize, true);
    document.addEventListener('transitionend', onResize, true);
    document.addEventListener('visibilitychange', onResize);
    cleanups.push(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('scroll', onResize);
      window.removeEventListener('pageshow', onResize);
      document.removeEventListener('animationend', onResize, true);
      document.removeEventListener('transitionend', onResize, true);
      document.removeEventListener('visibilitychange', onResize);
    });

    return () => cleanups.forEach((fn) => fn());
  }, [text, maxPx, minPx, fitRatio]);

  return {
    containerRef,
    measureRef,
    fontSize: sizing.fontSize,
    letterSpacing: sizing.letterSpacing,
  };
}

interface SimCI {
    timeH: number[];
    e2Adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
    ci68Low: number[];
    ci68High: number[];
    antiandrogen: Partial<Record<string, { adjusted: number[]; ci95Low: number[]; ci95High: number[] }>>;
}

interface OverviewViewProps {
  events: DoseEvent[];
  labResults: LabResult[];
  simulation: SimulationResult | null;
  currentTime: Date;
  simCI?: SimCI | null;
  baselineE2PGmL?: number | null;
  onAddEvent: () => void;
  onEditEvent: (event: DoseEvent) => void;
}

function interpAt(timeH: number[], values: number[], h: number): number {
  if (!timeH.length || !values.length) return 0;
  if (h <= timeH[0]) return values[0];
  if (h >= timeH[timeH.length - 1]) return values[values.length - 1];
  let lo = 0, hi = timeH.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeH[mid] <= h) lo = mid; else hi = mid;
  }
  const frac = (timeH[hi] - timeH[lo]) > 0
    ? (h - timeH[lo]) / (timeH[hi] - timeH[lo])
    : 0;
  const v = values[lo] + frac * (values[hi] - values[lo]);
  return isFinite(v) ? v : 0;
}

const OverviewView: React.FC<OverviewViewProps> = ({
  events,
  labResults,
  simulation,
  currentTime,
  simCI,
  baselineE2PGmL,
  onAddEvent,
  onEditEvent,
}) => {
  const { t, lang } = useTranslation();
  const { isDark, colors } = useTheme();
  const [shareImageOpen, setShareImageOpen] = useState(false);
  const h = currentTime.getTime() / 3600000;

  const hasPersonalModel = !!simCI && simCI.e2Adjusted.length > 0;
  const hasDoseHistory = events.length > 0;

  // The "primary" anti-androgen shown in the headline / side tile = the most
  // recently dosed one (CPA and BICA are clinical alternatives).
  const primaryAA = useMemo<Ester | null>(
    () => pickPrimaryAntiandrogen(events, h),
    [events, h]
  );
  const primaryAASpec = primaryAA ? ANTIANDROGENS[primaryAA]! : null;
  const aaCI = (primaryAA && simCI) ? simCI.antiandrogen[primaryAA] : undefined;
  const hasPersonalAaModel = !!aaCI && aaCI.adjusted.length === (simCI?.timeH.length ?? -1) && aaCI.adjusted.length > 0;

  const rawLevel = useMemo(() => {
    if (!simulation) return 0;
    const drugE2 = interpolateConcentration_E2(simulation, h) || 0;
    const shift = (!hasPersonalModel && baselineE2PGmL && baselineE2PGmL > 0)
      ? baselineE2PGmL
      : 0;
    return drugE2 + shift;
  }, [simulation, h, hasPersonalModel, baselineE2PGmL]);

  const baselineLevel = useMemo(() => {
    if (!hasDoseHistory && labResults.length > 0) {
      const latest = [...labResults].sort((a, b) => b.timeH - a.timeH)[0];
      const v = convertToPgMl(latest.concValue, latest.unit);
      return Number.isFinite(v) && v > 0 ? v : null;
    }
    if (hasDoseHistory && !hasPersonalModel && baselineE2PGmL && baselineE2PGmL > 0) {
      return baselineE2PGmL;
    }
    return null;
  }, [hasDoseHistory, hasPersonalModel, baselineE2PGmL, labResults]);

  const personalLevel = useMemo(() => {
    if (!hasPersonalModel) return null;
    const v = interpAt(simCI!.timeH, simCI!.e2Adjusted, h);
    return (v > 0 && v < 5000) ? v : null;
  }, [hasPersonalModel, simCI, h]);

  const currentLevel = personalLevel ?? (rawLevel || baselineLevel || 0);

  const currentCI = useMemo(() => {
    if (!hasPersonalModel) return null;
    const lo = interpAt(simCI!.timeH, simCI!.ci95Low, h);
    const hi = interpAt(simCI!.timeH, simCI!.ci95High, h);
    if (lo > 0 && hi > 0 && hi > lo) return { lo, hi };
    return null;
  }, [hasPersonalModel, simCI, h]);

  // Anti-androgen current level (native ng/mL) for the primary compound.
  const rawAA = useMemo(() => {
    if (!simulation || !primaryAA) return 0;
    return interpolateCompoundConcentration(simulation, primaryAA, h) || 0;
  }, [simulation, primaryAA, h]);

  const personalAA = useMemo(() => {
    if (!hasPersonalAaModel || !aaCI || !primaryAASpec) return null;
    const v = interpAt(simCI!.timeH, aaCI.adjusted, h);
    return (v > 0 && v <= primaryAASpec.ciMaxNative) ? v : null;
  }, [hasPersonalAaModel, aaCI, primaryAASpec, simCI, h]);

  const currentAA = personalAA ?? rawAA;
  const E2_DOSE_MAX_FONT_PX = 24;

  const currentAACI = useMemo(() => {
    if (!hasPersonalAaModel || !aaCI) return null;
    if (aaCI.ci95Low.length !== simCI!.timeH.length || aaCI.ci95High.length !== simCI!.timeH.length) {
      return null;
    }
    const lo = interpAt(simCI!.timeH, aaCI.ci95Low, h);
    const hi = interpAt(simCI!.timeH, aaCI.ci95High, h);
    if (lo > 0 && hi > 0 && hi > lo) return { lo, hi };
    return null;
  }, [hasPersonalAaModel, aaCI, simCI, h]);

  const currentCI68 = useMemo(() => {
    if (!hasPersonalModel) return null;
    if (!simCI!.ci68Low?.length || simCI!.ci68Low.length !== simCI!.timeH.length) return null;
    const lo = interpAt(simCI!.timeH, simCI!.ci68Low, h);
    const hi = interpAt(simCI!.timeH, simCI!.ci68High, h);
    if (lo > 0 && hi > 0 && hi > lo) return { lo, hi };
    return null;
  }, [hasPersonalModel, simCI, h]);

  // Latest anti-androgen dose (any route, ester ∈ {CPA, BICA}). Skips events
  // scheduled in the future so a batch-imported plan or a manually post-dated
  // entry doesn't pretend to be "the last dose" on the homepage.
  const lastAntiandrogenDose = useMemo<DoseEvent | null>(() => {
    let latest: DoseEvent | null = null;
    for (const ev of events) {
      if (!isAntiandrogen(ev.ester)) continue;
      if (ev.timeH > h) continue;
      if (!latest || ev.timeH > latest.timeH) latest = ev;
    }
    return latest;
  }, [events, h]);

  // Latest non-oral estradiol dose (injection / sublingual / gel / patch
  // apply). Patch-remove events are excluded because they represent removal,
  // not an administration the user would think of as "the last dose". Future
  // events are also excluded (see lastCPADose).
  const lastE2Dose = useMemo<DoseEvent | null>(() => {
    let latest: DoseEvent | null = null;
    for (const ev of events) {
      if (isAntiandrogen(ev.ester)) continue;
      if (ev.route === Route.oral) continue;
      if (ev.route === Route.patchRemove) continue;
      if (ev.timeH > h) continue;
      if (!latest || ev.timeH > latest.timeH) latest = ev;
    }
    return latest;
  }, [events, h]);

  // Pre-format the E2 dose display string. Font size is computed dynamically
  // via useAutoFitFontSize below so the dose + ester abbreviation stays on a
  // single line regardless of breakpoint or string length.
  const lastE2DoseStr = useMemo<string>(() => {
    if (!lastE2Dose) return '';
    const rate = lastE2Dose.extras?.[ExtraKey.releaseRateUGPerDay];
    if (lastE2Dose.route === Route.patchApply && rate) {
      return `${rate} µg/d`;
    }
    const digits = lastE2Dose.doseMG >= 10 ? 1 : 2;
    if (lastE2Dose.ester === Ester.E2) return `${lastE2Dose.doseMG.toFixed(digits)} mg`;
    return `${lastE2Dose.doseMG.toFixed(digits)} mg ${t(`ester.${lastE2Dose.ester}`)}`;
  }, [lastE2Dose, t]);

  // Auto-fit the dose font to whatever container width is currently available.
  // Keep it visually balanced instead of forcing it to fill the card.
  const { containerRef: e2DoseRef, measureRef: e2MeasureRef, fontSize: e2DoseFontSize, letterSpacing: e2DoseLetterSpacing } = useAutoFitFontSize(
    lastE2DoseStr,
    E2_DOSE_MAX_FONT_PX,
    12,
    0.86,
  );

  // Relative-time formatter ("3h 前", "2d ago"). Falls back to absolute date
  // when older than ~30 days so old-record context stays readable.
  const formatTimeAgo = (eventTimeH: number): string => {
    const nowMs = currentTime.getTime();
    const evMs = eventTimeH * 3600000;
    const diffMin = Math.max(0, (nowMs - evMs) / 60000);
    if (diffMin < 1) return t('overview.just_now');
    if (diffMin < 60) return t('overview.min_ago').replace('{n}', String(Math.floor(diffMin)));
    const diffH = diffMin / 60;
    if (diffH < 24) return t('overview.hour_ago').replace('{n}', String(Math.floor(diffH)));
    const diffD = diffH / 24;
    if (diffD < 30) {
      // Keep hour precision past the one-day mark so "2d" reads as "2d 5h"
      // instead of silently dropping the remaining hours. Fall back to the
      // plain day form on an exact day boundary to avoid a dangling "0h".
      const days = Math.floor(diffH / 24);
      const hours = Math.floor(diffH % 24);
      if (hours === 0) return t('overview.day_ago').replace('{n}', String(days));
      return t('overview.day_hour_ago').replace('{d}', String(days)).replace('{h}', String(hours));
    }
    const d = new Date(evMs);
    return d.toLocaleDateString(lang === 'zh' ? 'zh-CN' : lang === 'zh-TW' ? 'zh-TW' : lang === 'ja' ? 'ja-JP' : 'en-US',
      { month: 'short', day: 'numeric' });
  };

  const getLevelStatus = (conc: number) => {
    if (conc > 300) return { label: 'status.level.high', color: 'var(--accent-600)', bg: 'var(--accent-50)', border: 'var(--accent-200)' };
    if (conc >= 100 && conc <= 200) return { label: 'status.level.mtf', color: isDark ? '#34d399' : '#059669', bg: isDark ? 'rgba(5,150,105,0.15)' : '#ecfdf5', border: isDark ? 'rgba(5,150,105,0.3)' : '#a7f3d0' };
    if (conc >= 70 && conc <= 300) return { label: 'status.level.luteal', color: isDark ? '#60a5fa' : '#2563eb', bg: isDark ? 'rgba(37,99,235,0.15)' : '#eff6ff', border: isDark ? 'rgba(37,99,235,0.3)' : '#bfdbfe' };
    if (conc >= 30 && conc < 70) return { label: 'status.level.follicular', color: isDark ? '#818cf8' : '#4f46e5', bg: isDark ? 'rgba(79,70,229,0.15)' : '#eef2ff', border: isDark ? 'rgba(79,70,229,0.3)' : '#c7d2fe' };
    if (conc >= 8 && conc < 30) return { label: 'status.level.male', color: 'var(--text-secondary)', bg: 'var(--bg-card-hover)', border: 'var(--border-primary)' };
    return { label: 'status.level.low', color: isDark ? '#fbbf24' : '#d97706', bg: isDark ? 'rgba(217,119,6,0.15)' : '#fffbeb', border: isDark ? 'rgba(217,119,6,0.3)' : '#fde68a' };
  };

  const currentStatus = useMemo(() => {
    if (currentLevel > 0) return getLevelStatus(currentLevel);
    return null;
  }, [currentLevel, isDark]);

  // Format a stored dose (mg) for display: show the exact value the user
  // entered instead of rounding it. Trailing zeros are stripped so 12.5 → "12.5",
  // 25 → "25", 6.25 → "6.25". Capped at 3 decimals to drop floating-point noise,
  // matching the precision the dose editor persists (DoseFormModal uses toFixed(3)).
  const formatDoseMG = (mg: number): string => `${parseFloat(mg.toFixed(3))}`;

  const formatHeadlineE2 = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
  // Format an anti-androgen value for the headline, auto-scaling ng/mL → µg/mL.
  const formatHeadlineAA = (ngml: number, spec: typeof primaryAASpec) => {
    if (!spec) return { value: '--', unit: 'ng/mL' };
    const { value, unit } = formatAntiandrogenConc(ngml, spec);
    const text = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
    return { value: text, unit };
  };

  return (
    <>
      <header className="relative overflow-x-hidden px-3 md:px-8 pt-4 md:pt-6 pb-3 md:pb-4">
        <div className="grid md:grid-cols-3 gap-2.5 md:gap-4 md:items-stretch">
          {/* Main level card */}
          <div className="md:col-span-2 glass-card glass-highlight glass-accent rounded-2xl px-4 md:px-5 py-4 md:py-5 relative overflow-hidden"
            style={{
              background: isDark
                ? `linear-gradient(135deg, rgba(${hexToRgb(colors[500])},0.12), var(--bg-card))`
                : `linear-gradient(135deg, rgba(${hexToRgb(colors[500])},0.06), var(--bg-card))`,
            }}>
            <div className="flex items-start justify-between gap-2 mb-3">
              <h1 className="inline-flex min-w-0 flex-wrap items-center gap-2 px-3 py-1 rounded-full text-[11px] md:text-xs font-semibold border"
                style={{
                  background: 'var(--bg-card)',
                  color: 'var(--text-secondary)',
                  borderColor: 'var(--border-primary)',
                }}>
                <Activity size={14} style={{ color: 'var(--text-tertiary)' }} />
                {t('status.estimate')}
                {hasPersonalModel && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                    style={{
                      background: 'var(--accent-50)',
                      color: 'var(--accent-500)',
                      border: `1px solid var(--accent-200)`,
                    }}>
                    {t('chart.personal_model')}
                  </span>
                )}
              </h1>
              <button
                type="button"
                onClick={onAddEvent}
                aria-label={t('btn.add')}
                className="md:hidden shrink-0 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-2.5 min-[360px]:px-3 text-xs font-bold text-white glass-btn-primary btn-press-glass transition"
              >
                <Plus size={15} aria-hidden="true" />
                <span className="hidden min-[360px]:inline">{t('btn.add')}</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* E2 Display */}
              <div className="space-y-1">
                <div className="text-[10px] md:text-xs font-bold uppercase tracking-wider"
                  style={{ color: 'var(--accent-400)' }}>
                  E2
                </div>
                <div className="flex items-end gap-2">
                  {currentLevel > 0 ? (
                    <>
                      <span className="text-4xl md:text-5xl font-black tracking-tight"
                        style={{ color: 'var(--accent-500)' }}>
                        {formatHeadlineE2(currentLevel)}
                      </span>
                      <span className="text-sm md:text-base font-bold mb-1"
                        style={{ color: 'var(--accent-300)' }}>pg/mL</span>
                    </>
                  ) : (
                    <span className="text-4xl md:text-5xl font-black tracking-tight"
                      style={{ color: 'var(--text-tertiary)' }}>
                      --
                    </span>
                  )}
                </div>
                {currentCI && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide"
                      style={{ color: 'var(--accent-300)' }}>95% CI</span>
                    <span className="text-[11px] font-semibold"
                      style={{ color: 'var(--accent-400)' }}>
                      {currentCI.lo.toFixed(0)} – {currentCI.hi.toFixed(0)}
                      <span className="text-[9px] font-normal ml-0.5" style={{ color: 'var(--accent-300)' }}>pg/mL</span>
                    </span>
                  </div>
                )}
                {currentCI68 && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide"
                      style={{ color: 'var(--accent-300)' }}>{t('chart.ci68_band')}</span>
                    <span className="text-[11px] font-semibold"
                      style={{ color: 'var(--accent-400)' }}>
                      {currentCI68.lo.toFixed(0)} – {currentCI68.hi.toFixed(0)}
                      <span className="text-[9px] font-normal ml-0.5" style={{ color: 'var(--accent-300)' }}>pg/mL</span>
                    </span>
                  </div>
                )}
                {personalLevel !== null && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide"
                      style={{ color: 'var(--accent-300)' }}>
                      {t('chart.personal_model')}
                    </span>
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--accent-500)' }}>
                      {personalLevel.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {hasPersonalModel && rawLevel > 0 && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Raw</span>
                    <span className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      {rawLevel.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {!hasDoseHistory && baselineLevel !== null && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wide">Baseline</span>
                    <span className="text-[10px] font-semibold text-teal-500">
                      {baselineLevel.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {hasDoseHistory && !hasPersonalModel && baselineE2PGmL != null && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wide">Endogenous</span>
                    <span className="text-[10px] font-semibold text-teal-500">
                      {baselineE2PGmL.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {currentStatus && (
                  <div className="px-2.5 py-1 rounded-lg border flex items-center gap-1.5 mt-1 w-fit"
                    style={{
                      background: currentStatus.bg,
                      borderColor: currentStatus.border,
                    }}>
                    <Info size={10} style={{ color: currentStatus.color }} />
                    <span className="text-[9px] md:text-[10px] font-bold" style={{ color: currentStatus.color }}>
                      {t(currentStatus.label)}
                    </span>
                  </div>
                )}
              </div>

              {/* Anti-androgen Display (CPA / bicalutamide, auto-unit) */}
              {(() => {
                const aaLabel = primaryAA ?? 'CPA';
                const aaColor = primaryAASpec?.color ?? (isDark ? '#c084fc' : '#9333ea');
                const headline = formatHeadlineAA(currentAA, primaryAASpec);
                const fmt = (v: number) => primaryAASpec
                  ? formatAntiandrogenConc(v, primaryAASpec)
                  : { value: v, unit: 'ng/mL' as const };
                const fmtText = (v: number) => {
                  const { value } = fmt(v);
                  return value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
                };
                const noteKey = primaryAA === Ester.BICA ? 'chart.bica_note' : 'chart.cpa_note';
                return (
              <div className="space-y-1">
                <div className="text-[10px] md:text-xs font-bold uppercase tracking-wider"
                  style={{ color: aaColor }}>
                  {aaLabel}
                </div>
                <div className="flex items-end gap-2">
                  {currentAA > 0 ? (
                    <>
                      <span className="text-4xl md:text-5xl font-black tracking-tight"
                        style={{ color: aaColor }}>
                        {headline.value}
                      </span>
                      <span className="text-sm md:text-base font-bold mb-1"
                        style={{ color: aaColor, opacity: 0.7 }}>{headline.unit}</span>
                    </>
                  ) : (
                    <span className="text-4xl md:text-5xl font-black tracking-tight"
                      style={{ color: 'var(--text-tertiary)' }}>
                      --
                    </span>
                  )}
                </div>
                {hasPersonalAaModel && currentAA > 0 && (
                  <>
                    {currentAACI && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-wide"
                          style={{ color: aaColor, opacity: 0.8 }}>{t('chart.cpa_pop_range')}</span>
                        <span className="text-[11px] font-semibold"
                          style={{ color: aaColor }}>
                          {fmtText(currentAACI.lo)} – {fmtText(currentAACI.hi)}
                          <span className="text-[9px] font-normal ml-0.5"
                            style={{ color: aaColor, opacity: 0.8 }}>{fmt(currentAACI.hi).unit}</span>
                        </span>
                      </div>
                    )}
                    {primaryAASpec?.adherenceFromE2 && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-wide"
                          style={{ color: aaColor, opacity: 0.8 }}>
                          {t('chart.cpa_adherence')}
                        </span>
                        {personalAA !== null && (
                          <span className="text-[10px] font-semibold"
                            style={{ color: aaColor }}>
                            {fmtText(personalAA)} {fmt(personalAA).unit}
                          </span>
                        )}
                      </div>
                    )}
                    {rawAA > 0 && rawAA !== personalAA && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-tertiary)' }}>Base</span>
                        <span className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                          {fmtText(rawAA)} {fmt(rawAA).unit}
                        </span>
                      </div>
                    )}
                  </>
                )}
                {currentAA > 0 && (
                  <div className="mt-1 text-[9px] leading-tight italic" style={{ color: 'var(--text-tertiary)' }}>
                    {t(noteKey)}
                  </div>
                )}
              </div>
                );
              })()}
            </div>
          </div>

          {/* Side cards */}
          <div className="flex flex-col gap-3 md:h-full">

            {/* Row 1: total dose count + last CPA (compact, paired) */}
            <div className="grid grid-cols-2 gap-3">

              {/* Total dose count */}
              <div className="flex items-center gap-2 p-3 md:p-4 glass-card card-lift-glass min-w-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center border shrink-0"
                  style={{ background: 'var(--accent-50)', borderColor: 'var(--accent-200)' }}>
                  <Activity size={16} style={{ color: 'var(--accent-500)' }} />
                </div>
                <div className="leading-tight min-w-0 flex-1">
                  <p className="text-[10px] md:text-xs font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                    {t('overview.total_doses')}
                  </p>
                  <p className="text-lg md:text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {events.length || 0}
                  </p>
                </div>
              </div>

              {/* Last anti-androgen dose (CPA / bicalutamide) */}
              <div className="flex items-start gap-2 p-3 md:p-4 glass-card card-lift-glass min-w-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center border shrink-0"
                  style={{ background: 'var(--bg-card-hover)', borderColor: 'var(--border-primary)' }}>
                  <Pill size={16} style={{ color: '#3b82f6' }} />
                </div>
                <div className="leading-tight min-w-0 flex-1">
                  <p className="text-[10px] md:text-xs font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                    {t('overview.last_antiandrogen')}
                  </p>
                  {lastAntiandrogenDose ? (
                    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 mt-0.5 min-w-0">
                      <p className="text-sm md:text-base font-bold font-mono whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>
                        {`${formatDoseMG(lastAntiandrogenDose.doseMG)} mg`}
                      </p>
                      <span className="text-[9px] font-bold uppercase tracking-wide px-1 py-0.5 rounded"
                        style={{ background: 'var(--bg-card-hover)', color: 'var(--text-tertiary)' }}>
                        {lastAntiandrogenDose.ester}
                      </span>
                      <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                        {formatTimeAgo(lastAntiandrogenDose.timeH)}
                      </span>
                    </div>
                  ) : (
                    <p className="text-base md:text-lg font-bold" style={{ color: 'var(--text-tertiary)' }}>--</p>
                  )}
                </div>
              </div>

            </div>

            {/* Last estradiol dose (non-oral) — full width, content redistributes when stretched on desktop */}
            <div className="flex flex-col p-3 md:p-4 glass-card card-lift-glass md:flex-1 min-h-0">
              {/* Top row: icon + label + route badge + time-ago */}
              <div className="flex items-start gap-3 shrink-0">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl flex items-center justify-center border shrink-0"
                  style={{ background: 'var(--bg-card-hover)', borderColor: 'var(--border-primary)' }}>
                  {lastE2Dose
                    ? (
                      lastE2Dose.route === Route.injection ? <Syringe size={16} className="text-pink-400 md:w-5 md:h-5" />
                      : lastE2Dose.route === Route.sublingual ? <Pill size={16} className="text-teal-500 md:w-5 md:h-5" />
                      : lastE2Dose.route === Route.gel ? <Droplet size={16} className="text-cyan-500 md:w-5 md:h-5" />
                      : lastE2Dose.route === Route.patchApply ? <Sticker size={16} className="text-orange-500 md:w-5 md:h-5" />
                      : <Syringe size={16} style={{ color: 'var(--text-tertiary)' }} />
                    )
                    : <Syringe size={16} style={{ color: 'var(--text-tertiary)' }} />
                  }
                </div>
                <div className="leading-tight min-w-0 flex-1">
                  <p className="text-[11px] md:text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {t('overview.last_e2')}
                  </p>
                  {lastE2Dose && (
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mt-0.5">
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded"
                        style={{ background: 'var(--accent-50)', color: 'var(--accent-500)' }}>
                        {t(`route.${lastE2Dose.route}`)}
                      </span>
                      <span className="text-[10px] font-medium whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                        {formatTimeAgo(lastE2Dose.timeH)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Body: dose number — auto-fits to container width, always one line */}
              {lastE2Dose ? (
                <div className="flex flex-col mt-3 md:mt-4 md:flex-1 md:justify-center min-w-0">
                  <div ref={e2DoseRef} className="w-full min-w-0 relative overflow-hidden">
                    <p className="font-semibold font-mono leading-none whitespace-nowrap"
                      aria-label={lastE2DoseStr}
                      style={{ color: 'var(--text-secondary)', fontSize: `${e2DoseFontSize}px`, letterSpacing: `${e2DoseLetterSpacing}px` }}>
                      {lastE2DoseStr}
                    </p>
                    {/* Invisible measuring sibling at maxPx: the hook reads its
                        offsetWidth so the natural width matches what the DOM
                        would actually render — canvas measureText diverges
                        from the real font stack on some devices, which caused
                        the responsive sizing to fail on route remount. */}
                    <span
                      ref={e2MeasureRef}
                      aria-hidden
                      className="font-semibold font-mono whitespace-nowrap"
                      style={{
                        position: 'absolute',
                        display: 'inline-block',
                        left: 0,
                        top: 0,
                        width: 'max-content',
                        maxWidth: 'none',
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        fontSize: `${E2_DOSE_MAX_FONT_PX}px`,
                        letterSpacing: 'normal',
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {lastE2DoseStr}
                    </span>
                  </div>
                  <p className="text-[10px] md:text-xs font-mono mt-1.5 md:mt-2 whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                    {lastE2Dose.route === Route.patchApply
                      ? t('overview.patch_applied_at').replace('{time}', formatTime(new Date(lastE2Dose.timeH * 3600000)))
                      : formatTime(new Date(lastE2Dose.timeH * 3600000))}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col mt-3 md:flex-1 md:justify-center">
                  <p className="text-2xl md:text-3xl font-bold" style={{ color: 'var(--text-tertiary)' }}>--</p>
                </div>
              )}

              {/* Bottom-aligned extra info (sublingual hold time / θ).
                  Priority mirrors DoseFormModal: if both fields exist on stale
                  data, tier wins so the on-screen value matches what the edit
                  form will display. */}
              {lastE2Dose && lastE2Dose.route === Route.sublingual && (() => {
                const theta = lastE2Dose.extras?.[ExtraKey.sublingualTheta];
                const tierRaw = lastE2Dose.extras?.[ExtraKey.sublingualTier];
                let extraText: string | null = null;
                if (tierRaw !== undefined) {
                  const idx = Math.min(SL_TIER_ORDER.length - 1, Math.max(0, Math.round(tierRaw)));
                  extraText = t(`sl.mode.${SL_TIER_ORDER[idx]}`);
                } else if (theta !== undefined && Number.isFinite(theta)) {
                  extraText = `θ ${theta.toFixed(2)}`;
                }
                if (!extraText) return null;
                return (
                  <div className="mt-2 md:mt-3 pt-2 md:pt-3 border-t shrink-0"
                    style={{ borderColor: 'var(--border-secondary)' }}>
                    <p className="text-[10px] md:text-xs font-medium truncate" style={{ color: 'var(--text-secondary)' }}>
                      {t('field.sl_duration')}: <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{extraText}</span>
                    </p>
                  </div>
                );
              })()}
            </div>

          </div>
        </div>
      </header>

      <main className="w-full overflow-x-hidden px-3 md:px-4 py-4 md:py-6 rounded-t-3xl"
        style={{ background: 'var(--bg-card)', overscrollBehaviorX: 'none' }}>
        <ResultChart
          sim={simulation}
          events={events}
          onPointClick={onEditEvent}
          labResults={labResults}
          simCI={simCI}
          baselineE2PGmL={baselineE2PGmL}
          nowH={h}
          onShareImage={() => setShareImageOpen(true)}
        />
      </main>

      <ShareImageModal
        isOpen={shareImageOpen}
        onClose={() => setShareImageOpen(false)}
        events={events}
        labResults={labResults}
        simulation={simulation}
        simCI={simCI}
        baselineE2PGmL={baselineE2PGmL}
      />
    </>
  );
};

export default OverviewView;
