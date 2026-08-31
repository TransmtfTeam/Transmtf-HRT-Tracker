import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { formatDate, formatTime } from '../utils/helpers';
import { SimulationResult, DoseEvent, interpolateConcentration_E2, interpolateCompoundConcentration, isAntiandrogen, pickPrimaryAntiandrogen, ANTIANDROGENS, Ester, LabResult, convertToPgMl } from '../../logic';
import { Activity, RotateCcw, Info, FlaskConical, Camera } from 'lucide-react';
import { calculateNiceAxis } from '../utils/chartAxis';
import {
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceDot, Area, AreaChart, ComposedChart, Scatter, Brush
} from 'recharts';

interface SimCI {
    timeH: number[];
    e2Adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
    ci68Low: number[];
    ci68High: number[];
    antiandrogen: Partial<Record<string, { adjusted: number[]; ci95Low: number[]; ci95High: number[] }>>;
}

interface ChartPoint {
    time: number;
    concE2?: number;
    concCPA?: number;
    concPersonal?: number;
    concPersonalCPA?: number;
    ci95Low?: number;
    ci95Band?: number;
    ci95High?: number;
    ci68Low?: number;
    ci68Band?: number;
    ci68High?: number;
    cpaCi95Low?: number;
    cpaCi95Band?: number;
    cpaCi95High?: number;
}

function pointExtrema(d: ChartPoint): { min: number; max: number } {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    const include = (v: number | undefined) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        if (v < min) min = v;
        if (v > max) max = v;
    };

    include(d.concE2);
    include(d.concPersonal);
    include(d.ci95Low);
    include(d.ci95High);
    include(d.ci68Low);
    include(d.ci68High);
    include(d.concCPA);
    include(d.concPersonalCPA);
    include(d.cpaCi95Low);
    include(d.cpaCi95High);

    if (min === Number.POSITIVE_INFINITY || max === Number.NEGATIVE_INFINITY) {
        return { min: 0, max: 0 };
    }
    return { min, max };
}

function downsampleSeries(series: ChartPoint[], maxPoints = 600): ChartPoint[] {
    if (series.length <= maxPoints) return series;
    if (maxPoints < 3) return [series[0], series[series.length - 1]];

    const first = series[0];
    const last = series[series.length - 1];
    const interiorStart = 1;
    const interiorCount = Math.max(0, series.length - 2);

    if (interiorCount === 0) return [first, last];

    // Keep up to two representative points (min/max) per bucket.
    const maxBuckets = Math.max(1, Math.floor((maxPoints - 2) / 2));
    const bucketCount = Math.min(maxBuckets, interiorCount);
    const sampled: ChartPoint[] = [first];

    for (let bucket = 0; bucket < bucketCount; bucket++) {
        const from = interiorStart + Math.floor((bucket * interiorCount) / bucketCount);
        const to = interiorStart + Math.floor(((bucket + 1) * interiorCount) / bucketCount) - 1;
        if (from > to) continue;

        let minIdx = from;
        let maxIdx = from;
        let minVal = Number.POSITIVE_INFINITY;
        let maxVal = Number.NEGATIVE_INFINITY;

        for (let i = from; i <= to; i++) {
            const { min, max } = pointExtrema(series[i]);
            if (min < minVal) {
                minVal = min;
                minIdx = i;
            }
            if (max > maxVal) {
                maxVal = max;
                maxIdx = i;
            }
        }

        if (minIdx === maxIdx) {
            sampled.push(series[minIdx]);
            continue;
        }

        if (minIdx < maxIdx) {
            sampled.push(series[minIdx], series[maxIdx]);
        } else {
            sampled.push(series[maxIdx], series[minIdx]);
        }
    }

    sampled.push(last);

    const deduped: ChartPoint[] = [];
    for (const point of sampled) {
        if (!deduped.length || deduped[deduped.length - 1].time !== point.time) {
            deduped.push(point);
        }
    }
    if (deduped.length <= maxPoints) return deduped;

    const compact: ChartPoint[] = [];
    const interval = (deduped.length - 1) / (maxPoints - 1);
    for (let i = 0; i < maxPoints; i++) {
        const idx = Math.round(i * interval);
        const point = deduped[idx];
        if (!compact.length || compact[compact.length - 1].time !== point.time) {
            compact.push(point);
        }
    }
    if (compact.length > 0) {
        compact[compact.length - 1] = deduped[deduped.length - 1];
    }
    return compact;
}

function interpAt(timeH: number[], values: number[], h: number): number | undefined {
    if (!timeH.length || !values.length || timeH.length !== values.length) return undefined;
    if (h <= timeH[0]) return values[0];
    if (h >= timeH[timeH.length - 1]) return values[values.length - 1];
    let lo = 0;
    let hi = timeH.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (timeH[mid] <= h) lo = mid;
        else hi = mid;
    }
    const span = timeH[hi] - timeH[lo];
    const frac = span > 0 ? (h - timeH[lo]) / span : 0;
    const v = values[lo] + (values[hi] - values[lo]) * frac;
    return Number.isFinite(v) ? v : undefined;
}

const CustomTooltip = ({ active, payload, label, t, lang, aaLabel = 'CPA', aaUnit = 'ng/mL', aaColor = '#8b5cf6', aaShowPersonal = true }: any) => {
    if (active && payload && payload.length) {
        // If it's a lab result point
        if (payload[0].payload.isLabResult) {
            const data = payload[0].payload;
            return (
                <div className="bg-[var(--bg-card)]/90 backdrop-blur-sm px-3 py-2 rounded-xl border border-teal-100/50 dark:border-teal-800/50 shadow-sm">
                    <p className="text-[10px] font-medium mb-0.5 flex items-center gap-1" style={{ color: 'var(--text-tertiary)' }}>
                        <FlaskConical size={10} />
                        {formatDate(new Date(label), lang)} {formatTime(new Date(label))}
                    </p>
                    <div className="flex items-baseline gap-1">
                        <span className="text-base font-black text-teal-600 tracking-tight">
                            {data.originalValue}
                        </span>
                        <span className="text-[10px] font-bold text-teal-400">{data.originalUnit}</span>
                    </div>
                    {data.originalUnit === 'pmol/l' && (
                        <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                            ≈ {data.conc.toFixed(1)} pg/mL
                        </div>
                    )}
                </div>
            );
        }

        const dataPoint = payload[0].payload;
        const concE2 = dataPoint.concE2 || 0;
        const concCPA = dataPoint.concCPA || 0;
        const concPersonal = dataPoint.concPersonal;
        const concPersonalCPA = dataPoint.concPersonalCPA;
        const ciLow = dataPoint.ci95Low;
        const ciHigh = dataPoint.ci95High;
        const ci68Low = dataPoint.ci68Low;
        const ci68High = dataPoint.ci68High;
        const cpaCiLow = dataPoint.cpaCi95Low;
        const cpaCiHigh = dataPoint.cpaCi95High;

        return (
            <div className="bg-[var(--bg-card)]/90 backdrop-blur-sm px-3 py-2 rounded-xl border border-pink-100/50 dark:border-pink-800/50 shadow-sm">
                <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--text-tertiary)' }}>
                    {formatDate(new Date(label), lang)} {formatTime(new Date(label))}
                </p>
                {concE2 > 0 && (
                    <div className="flex items-baseline gap-1">
                        <span className="text-[9px] font-bold text-pink-400">E2:</span>
                        <span className="text-sm font-black text-pink-500 tracking-tight">
                            {concE2.toFixed(1)}
                        </span>
                        <span className="text-[10px] font-bold text-pink-300">pg/mL</span>
                    </div>
                )}
                {concPersonal !== undefined && concPersonal > 0 && (
                    <div className="mt-0.5">
                        <div className="flex items-baseline gap-1">
                            <span className="text-[9px] font-bold text-rose-400">{t('chart.personal_model')} E2:</span>
                            <span className="text-sm font-black text-rose-600 tracking-tight">
                                {concPersonal.toFixed(1)}
                            </span>
                            <span className="text-[10px] font-bold text-rose-300">pg/mL</span>
                        </div>
                        {ci68Low !== undefined && ci68High !== undefined && (
                            <div className="flex items-center gap-1 ml-1 mt-0.5">
                                <span className="text-[8px] font-bold text-rose-300 uppercase w-8">{t('chart.ci68_band')}</span>
                                <span className="text-[9px] text-rose-400 font-medium">
                                    {ci68Low.toFixed(0)} – {ci68High.toFixed(0)}
                                    <span className="text-[8px] font-normal text-rose-300 ml-0.5">pg/mL</span>
                                </span>
                            </div>
                        )}
                        {ciLow !== undefined && ciHigh !== undefined && (
                            <div className="flex items-center gap-1 ml-1 mt-0.5">
                                <span className="text-[8px] font-bold uppercase w-8" style={{ color: 'var(--text-tertiary)' }}>{t('chart.ci_band')}</span>
                                <span className="text-[9px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                                    {ciLow.toFixed(0)} – {ciHigh.toFixed(0)}
                                    <span className="text-[8px] font-normal ml-0.5" style={{ color: 'var(--text-tertiary)' }}>pg/mL</span>
                                </span>
                            </div>
                        )}
                    </div>
                )}
                {concCPA > 0 && (
                    <div className="flex items-baseline gap-1 mt-0.5">
                        <span className="text-[9px] font-bold" style={{ color: aaColor }}>{aaLabel}:</span>
                        <span className="text-sm font-black tracking-tight" style={{ color: aaColor }}>
                            {concCPA.toFixed(2)}
                        </span>
                        <span className="text-[10px] font-bold" style={{ color: aaColor, opacity: 0.7 }}>{aaUnit}</span>
                    </div>
                )}
                {/* Population CI for non-personalized compounds (BICA): no "personal" label. */}
                {!aaShowPersonal && concCPA > 0 && cpaCiLow !== undefined && cpaCiHigh !== undefined && (
                    <div className="flex items-center gap-1 ml-1 mt-0.5">
                        <span className="text-[8px] font-bold uppercase w-12" style={{ color: 'var(--text-tertiary)' }}>{t('chart.cpa_pop_range')}</span>
                        <span className="text-[9px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                            {cpaCiLow.toFixed(2)} – {cpaCiHigh.toFixed(2)}
                            <span className="text-[8px] font-normal ml-0.5" style={{ color: 'var(--text-tertiary)' }}>{aaUnit}</span>
                        </span>
                    </div>
                )}
                {aaShowPersonal && concPersonalCPA !== undefined && concPersonalCPA > 0 && (
                    <div className="mt-0.5">
                        <div className="flex items-baseline gap-1">
                            <span className="text-[9px] font-bold" style={{ color: aaColor }}>{t('chart.personal_model')} {aaLabel}:</span>
                            <span className="text-sm font-black tracking-tight" style={{ color: aaColor }}>
                                {concPersonalCPA.toFixed(2)}
                            </span>
                            <span className="text-[10px] font-bold" style={{ color: aaColor, opacity: 0.7 }}>{aaUnit}</span>
                        </div>
                        {cpaCiLow !== undefined && cpaCiHigh !== undefined && (
                            <div className="flex items-center gap-1 ml-1 mt-0.5">
                                <span className="text-[8px] font-bold uppercase w-8" style={{ color: 'var(--text-tertiary)' }}>{t('chart.ci_band')}</span>
                                <span className="text-[9px] font-medium" style={{ color: 'var(--text-secondary)' }}>
                                    {cpaCiLow.toFixed(2)} – {cpaCiHigh.toFixed(2)}
                                    <span className="text-[8px] font-normal ml-0.5" style={{ color: 'var(--text-tertiary)' }}>{aaUnit}</span>
                                </span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
    return null;
};

const ResultChart = ({ sim, events, labResults = [], simCI, baselineE2PGmL, nowH, onPointClick, onShareImage }: {
    sim: SimulationResult | null;
    events: DoseEvent[];
    labResults?: LabResult[];
    simCI?: SimCI | null;
    baselineE2PGmL?: number | null;
    nowH?: number;
    onPointClick: (e: DoseEvent) => void;
    onShareImage?: () => void;
}) => {
    // The single anti-androgen plotted on the right axis = the most recently
    // dosed one (CPA and BICA are alternatives with ~1000× different scales).
    // `nowH` is passed reactively so the choice updates as planned doses cross
    // the current time; falls back to render-time clock if not provided.
    const primaryAA = useMemo<Ester | null>(
        () => pickPrimaryAntiandrogen(events, nowH ?? Date.now() / 3600000),
        [events, nowH]
    );
    const aaSpec = primaryAA ? ANTIANDROGENS[primaryAA]! : null;
    const hasCPADoses = !!primaryAA; // "has anti-androgen on right axis"
    // Display unit + scale: native is ng/mL; bicalutamide (large) shows as µg/mL.
    const aaUnit: 'ng/mL' | 'ug/mL' = primaryAA === Ester.BICA ? 'ug/mL' : 'ng/mL';
    const aaScale = aaUnit === 'ug/mL' ? 1 / 1000 : 1;
    const aaColor = aaSpec?.color ?? '#8b5cf6';
    const aaLabel = primaryAA ?? 'CPA';
    // Only compounds that inherit E2 adherence (CPA) get an individualized
    // "personal" curve/label. BICA is population-only, so it shows its raw curve
    // plus a population CI band, never a "personal model" dashed line.
    const aaPersonalized = !!aaSpec?.adherenceFromE2;
    // "E2 personal model active" = a real post-dose calibration exists. This is
    // distinct from `!!simCI`: simCI may be present purely to carry the
    // anti-androgen population CI (E2 arrays empty) when there are no E2 labs.
    const hasE2Personal = !!simCI && simCI.e2Adjusted.length > 0;
    const { t, lang } = useTranslation();
    const [xDomain, setXDomain] = useState<[number, number] | null>(null);
    const initializedRef = useRef(false);
    const pendingDomainRef = useRef<[number, number] | null>(null);
    const rafUpdateRef = useRef<number | null>(null);
    const E2_AXIS_FALLBACK_MAX = 10;
    const CPA_AXIS_FALLBACK_MAX = 1;
    const AXIS_TICK_COUNT = 4;
    const MAX_RENDER_POINTS = 1200;
    const MAX_OVERVIEW_POINTS = 180;

    const formatAxisTick = (raw: any): string => {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return '0';
        if (n >= 100) return `${Math.round(n)}`;
        if (n >= 10) return `${Math.round(n)}`;
        if (n >= 1) return n.toFixed(1);
        return n.toFixed(2);
    };

    const niceFloor = (value: number, fallback: number): number => {
        if (!Number.isFinite(value)) return fallback;
        if (value <= 0) return 0;
        const exp = Math.floor(Math.log10(value));
        const base = Math.pow(10, exp);
        const norm = value / base;
        const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
        return step * base;
    };

    // Build CI lookup map for fast time-based access
    const aaCISeries = (primaryAA && simCI) ? simCI.antiandrogen[primaryAA] : undefined;
    const hasPersonalCpaModel = !!aaCISeries && !!simCI && aaCISeries.adjusted.length === simCI.timeH.length;
    const hasPersonalCpaCI = !!aaCISeries && !!simCI &&
        aaCISeries.ci95Low.length === simCI.timeH.length &&
        aaCISeries.ci95High.length === simCI.timeH.length;

    const ciMap = useMemo(() => {
        if (!simCI) return null;
        const m = new Map<number, {
            ci95Low: number;
            ci95High: number;
            ci68Low: number;
            ci68High: number;
            e2Adj: number;
            cpaAdj?: number;
            cpaCi95Low?: number;
            cpaCi95High?: number;
        }>();
        for (let i = 0; i < simCI.timeH.length; i++) {
            m.set(simCI.timeH[i], {
                ci95Low: simCI.ci95Low[i],
                ci95High: simCI.ci95High[i],
                ci68Low: simCI.ci68Low[i],
                ci68High: simCI.ci68High[i],
                e2Adj: simCI.e2Adjusted[i],
                cpaAdj: hasPersonalCpaModel ? aaCISeries!.adjusted[i] * aaScale : undefined,
                cpaCi95Low: hasPersonalCpaCI ? aaCISeries!.ci95Low[i] * aaScale : undefined,
                cpaCi95High: hasPersonalCpaCI ? aaCISeries!.ci95High[i] * aaScale : undefined,
            });
        }
        return m;
    }, [simCI, aaCISeries, hasPersonalCpaModel, hasPersonalCpaCI, aaScale]);

    const rawData = useMemo<ChartPoint[]>(() => {
        if (!sim || sim.timeH.length === 0) return [];
        // Apply endogenous baseline offset to the raw E2 curve when no personal
        // model is active (i.e. no post-dose lab results processed yet). This
        // makes the chart visually consistent with the "drug + endogenous" value
        // shown in the headline card.
        const hasPersonalModelCurve = hasE2Personal;
        const baseShift = (!hasPersonalModelCurve && baselineE2PGmL && baselineE2PGmL > 0)
            ? baselineE2PGmL
            : 0;

        return sim.timeH.map((t, i) => {
            const timeMs = t * 3600000;
            // E2: raw simulation (no calibrationFn; personal model curve shows the calibrated view)
            const baseE2 = sim.concPGmL_E2[i] + baseShift; // pg/mL (+ endogenous if no personal model)
            const aaSeries = primaryAA ? sim.byCompound?.[primaryAA] : undefined;
            const rawCPA_ngmL = (aaSeries ? aaSeries.values[i] : 0) * aaScale; // display unit

            // Personal model CI data (from OU-Kalman calibration)
            const ciEntry = ciMap?.get(t);
            const ci95Low = ciEntry?.ci95Low;
            const ci95High = ciEntry?.ci95High;
            const ci68Low = ciEntry?.ci68Low;
            const ci68High = ciEntry?.ci68High;
            const concPersonal = ciEntry?.e2Adj;
            const concPersonalCPA = ciEntry?.cpaAdj;
            const cpaCi95Low = ciEntry?.cpaCi95Low;
            const cpaCi95High = ciEntry?.cpaCi95High;
            // ci95Band = ci95High - ci95Low for stacked Area rendering
            const ci95Band = (ci95Low !== undefined && ci95High !== undefined)
                ? Math.max(0, ci95High - ci95Low)
                : undefined;
            // ci68Band = ci68High - ci68Low (inner, tighter band)
            const ci68Band = (ci68Low !== undefined && ci68High !== undefined)
                ? Math.max(0, ci68High - ci68Low)
                : undefined;
            const cpaCi95Band = (cpaCi95Low !== undefined && cpaCi95High !== undefined)
                ? Math.max(0, cpaCi95High - cpaCi95Low)
                : undefined;

            return {
                time: timeMs,
                concE2: baseE2,          // pg/mL, raw (reference curve)
                concCPA: rawCPA_ngmL,    // ng/mL, raw (reference curve)
                concPersonal,            // personal model E2 (pg/mL)
                concPersonalCPA,         // personal model CPA (ng/mL)
                ci95Low,
                ci95Band,
                ci95High,
                ci68Low,
                ci68Band,
                ci68High,
                cpaCi95Low,
                cpaCi95Band,
                cpaCi95High,
            };
        });
    }, [sim, ciMap, simCI, baselineE2PGmL, primaryAA, aaScale]);

    const data = useMemo(() => downsampleSeries(rawData, MAX_RENDER_POINTS), [rawData]);
    const overviewData = useMemo(() => downsampleSeries(rawData, MAX_OVERVIEW_POINTS), [rawData]);

    const labPoints = useMemo(() => {
        if (!labResults || labResults.length === 0) return [];
        return labResults.map(l => ({
            time: l.timeH * 3600000,
            conc: convertToPgMl(l.concValue, l.unit),
            originalValue: l.concValue,
            originalUnit: l.unit,
            isLabResult: true,
            id: l.id
        }));
    }, [labResults]);

    // Build dose event scatter points for marking on the chart
    const dosePoints = useMemo(() => {
        if (!sim || !events || events.length === 0) return [];
        return events.map(e => {
            const timeMs = e.timeH * 3600000;
            // Interpolate E2 at dose time for y-position
            const concE2Raw = interpolateConcentration_E2(sim, e.timeH);
            const hasPersonalModelCurve = hasE2Personal;
            const baseShift = (!hasPersonalModelCurve && baselineE2PGmL && baselineE2PGmL > 0)
                ? baselineE2PGmL
                : 0;
            const concE2 = concE2Raw !== null && !Number.isNaN(concE2Raw)
                ? concE2Raw + baseShift
                : 0;
            return {
                time: timeMs,
                concE2,
                isDoseEvent: true,
                ester: e.ester,
            };
        });
    }, [events, sim, simCI, baselineE2PGmL]);

    const { minTime, maxTime, now } = useMemo(() => {
        const series = rawData.length ? rawData : data;
        const n = new Date().getTime();
        if (series.length === 0) return { minTime: n, maxTime: n, now: n };
        return {
            minTime: series[0].time,
            maxTime: series[series.length - 1].time,
            now: n
        };
    }, [rawData, data]);

    // Compute left-axis Y domain from visible E2-related series in current viewport.
    // CI is included but bounded relative to the base curve, to avoid squeezing curves to the floor.
    const yAxisLeft = useMemo(() => {
        const visibleMin = xDomain ? xDomain[0] : minTime;
        const visibleMax = xDomain ? xDomain[1] : maxTime;
        // Use downsampled data during interactive sliding to reduce per-frame cost.
        const source = data;
        let basePeak = 0;
        let baseMin = Number.POSITIVE_INFINITY;
        let ciPeakRaw = 0;
        let hasBase = false;

        const includeBase = (v: number | undefined) => {
            if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
            hasBase = true;
            if (v > basePeak) basePeak = v;
            if (v < baseMin) baseMin = v;
        };

        const includeCi = (v: number | undefined) => {
            if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
            if (v > ciPeakRaw) ciPeakRaw = v;
        };

        for (const d of source) {
            if (d.time < visibleMin || d.time > visibleMax) continue;
            includeBase(d.concE2);
            includeBase(d.concPersonal);
            includeCi(d.ci95High);
        }
        for (const l of labPoints) {
            if (l.time >= visibleMin && l.time <= visibleMax) includeBase(l.conc);
        }
        // Ensure the endogenous baseline reference line is always within the axis range.
        if (!hasE2Personal && baselineE2PGmL && baselineE2PGmL > 0) {
            includeBase(baselineE2PGmL);
        }

        const minVal = hasBase ? baseMin : 0;
        const ciCap = basePeak > 0 ? Math.max(basePeak * 1.5, basePeak + 20) : E2_AXIS_FALLBACK_MAX;
        const ciPeak = Math.min(ciPeakRaw, ciCap);
        const peak = Math.max(basePeak, ciPeak, E2_AXIS_FALLBACK_MAX);
        const padded = Math.max(E2_AXIS_FALLBACK_MAX, peak * 1.12); // 12% headroom
        const lower = minVal > 0 ? niceFloor(minVal * 0.85, 0) : 0;
        return calculateNiceAxis(lower, padded, AXIS_TICK_COUNT, E2_AXIS_FALLBACK_MAX);
    }, [data, labPoints, xDomain, minTime, maxTime, simCI, baselineE2PGmL]);

    // Compute right-axis Y domain from visible CPA-related series in current viewport.
    const yAxisRight = useMemo(() => {
        const visibleMin = xDomain ? xDomain[0] : minTime;
        const visibleMax = xDomain ? xDomain[1] : maxTime;
        const source = data;
        let basePeak = 0;
        let ciPeakRaw = 0;

        const includeBase = (v: number | undefined) => {
            if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
            if (v > basePeak) basePeak = v;
        };

        const includeCi = (v: number | undefined) => {
            if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return;
            if (v > ciPeakRaw) ciPeakRaw = v;
        };

        for (const d of source) {
            if (d.time < visibleMin || d.time > visibleMax) continue;
            includeBase(d.concCPA);
            includeBase(d.concPersonalCPA);
            includeCi(d.cpaCi95High);
        }
        const ciCap = basePeak > 0 ? Math.max(basePeak * 1.5, basePeak + 0.2) : CPA_AXIS_FALLBACK_MAX;
        const ciPeak = Math.min(ciPeakRaw, ciCap);
        const peak = Math.max(basePeak, ciPeak, CPA_AXIS_FALLBACK_MAX);
        const padded = Math.max(CPA_AXIS_FALLBACK_MAX, peak * 1.12); // 12% headroom
        return calculateNiceAxis(0, padded, AXIS_TICK_COUNT, CPA_AXIS_FALLBACK_MAX);
    }, [data, xDomain, minTime, maxTime]);

    const nowPoint = useMemo(() => {
        if (!sim || data.length === 0) return null;
        const h = now / 3600000;

        const concE2Raw = interpolateConcentration_E2(sim, h);
        const concCPA = primaryAA ? (interpolateCompoundConcentration(sim, primaryAA, h) ?? null) : null;
        const concPersonal = simCI ? interpAt(simCI.timeH, simCI.e2Adjusted, h) : undefined;
        const ci95Low = simCI ? interpAt(simCI.timeH, simCI.ci95Low, h) : undefined;
        const ci95High = simCI ? interpAt(simCI.timeH, simCI.ci95High, h) : undefined;
        const ci68Low = simCI ? interpAt(simCI.timeH, simCI.ci68Low, h) : undefined;
        const ci68High = simCI ? interpAt(simCI.timeH, simCI.ci68High, h) : undefined;
        const concPersonalCPA = (hasPersonalCpaModel && aaCISeries)
            ? interpAt(simCI!.timeH, aaCISeries.adjusted, h) * aaScale
            : undefined;
        const cpaCi95Low = (hasPersonalCpaCI && aaCISeries)
            ? interpAt(simCI!.timeH, aaCISeries.ci95Low, h) * aaScale
            : undefined;
        const cpaCi95High = (hasPersonalCpaCI && aaCISeries)
            ? interpAt(simCI!.timeH, aaCISeries.ci95High, h) * aaScale
            : undefined;

        const hasE2 = concE2Raw !== null && !Number.isNaN(concE2Raw);
        const hasCPA = concCPA !== null && !Number.isNaN(concCPA);

        if (!hasE2 && !hasCPA) return null;

        // Apply the same baseline shift used in rawData so the "now" dot is
        // consistent with the underlying curve.
        const baseShift = (!hasE2Personal && baselineE2PGmL && baselineE2PGmL > 0)
            ? baselineE2PGmL
            : 0;
        const concE2 = hasE2 ? (concE2Raw! + baseShift) : 0;

        return {
            time: now,
            concE2,                            // pg/mL, raw (+ endogenous offset if needed)
            concCPA: hasCPA ? concCPA * aaScale : 0,     // display unit (ng/mL or µg/mL)
            concPersonal,
            ci95Low,
            ci95High,
            ci68Low,
            ci68High,
            concPersonalCPA,
            cpaCi95Low,
            cpaCi95High,
        };
    }, [sim, simCI, data, now, hasPersonalCpaModel, hasPersonalCpaCI, baselineE2PGmL, primaryAA, aaCISeries, aaScale]);

    // Slider helpers for quick panning (helps mobile users)
    // Initialize view: center on "now" with a reasonable window (e.g. 14 days)
    useEffect(() => {
        if (!initializedRef.current && data.length > 0) {
            const initialWindow = 7 * 24 * 3600 * 1000; // 1 week
            const start = Math.max(minTime, now - initialWindow / 2);
            const end = Math.min(maxTime, start + initialWindow);

            // Adjust if end is clamped
            const finalStart = Math.max(minTime, end - initialWindow);

            setXDomain([finalStart, end]);
            initializedRef.current = true;
        }
    }, [data, minTime, maxTime, now]);

    const clampDomain = useCallback((domain: [number, number]): [number, number] => {
        const width = domain[1] - domain[0];
        // Enforce min zoom (e.g. 1 day) and max zoom (total range)
        const MIN_ZOOM = 24 * 3600 * 1000;
        const MAX_ZOOM = Math.max(maxTime - minTime, MIN_ZOOM);

        let newWidth = Math.max(MIN_ZOOM, Math.min(width, MAX_ZOOM));
        let newStart = domain[0];
        let newEnd = newStart + newWidth;

        // Clamp to data bounds
        if (newStart < minTime) {
            newStart = minTime;
            newEnd = newStart + newWidth;
        }
        if (newEnd > maxTime) {
            newEnd = maxTime;
            newStart = newEnd - newWidth;
        }

        return [newStart, newEnd];
    }, [minTime, maxTime]);

    const commitDomain = useCallback((next: [number, number]) => {
        setXDomain(prev => {
            if (prev && prev[0] === next[0] && prev[1] === next[1]) return prev;
            return next;
        });
    }, []);

    const scheduleDomainUpdate = useCallback((next: [number, number]) => {
        pendingDomainRef.current = next;
        if (rafUpdateRef.current !== null) return;
        rafUpdateRef.current = window.requestAnimationFrame(() => {
            rafUpdateRef.current = null;
            const pending = pendingDomainRef.current;
            pendingDomainRef.current = null;
            if (!pending) return;
            commitDomain(pending);
        });
    }, [commitDomain]);

    useEffect(() => {
        return () => {
            if (rafUpdateRef.current !== null) {
                window.cancelAnimationFrame(rafUpdateRef.current);
                rafUpdateRef.current = null;
            }
        };
    }, []);

    const zoomToDuration = (days: number) => {
        const duration = days * 24 * 3600 * 1000;
        const currentCenter = xDomain ? (xDomain[0] + xDomain[1]) / 2 : now;
        const targetCenter = (now >= minTime && now <= maxTime) ? now : currentCenter;

        const start = targetCenter - duration / 2;
        const end = targetCenter + duration / 2;
        commitDomain(clampDomain([start, end]));
    };

    const findClosestIndex = useCallback((series: { time: number }[], time: number) => {
        if (series.length === 0) return 0;
        let low = 0;
        let high = series.length - 1;
        while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (series[mid].time === time) return mid;
            if (series[mid].time < time) low = mid;
            else high = mid;
        }
        return Math.abs(series[high].time - time) < Math.abs(series[low].time - time) ? high : low;
    }, []);

    const brushRange = useMemo(() => {
        if (overviewData.length === 0) return { startIndex: 0, endIndex: 0 };
        const domain = xDomain || [minTime, maxTime];
        const startIndex = findClosestIndex(overviewData, domain[0]);
        const endIndexRaw = findClosestIndex(overviewData, domain[1]);
        const endIndex = Math.max(startIndex + 1, endIndexRaw);
        return { startIndex, endIndex: Math.min(overviewData.length - 1, endIndex) };
    }, [overviewData, xDomain, minTime, maxTime, findClosestIndex]);

    const handleBrushChange = (range: { startIndex?: number; endIndex?: number }) => {
        if (!range || range.startIndex === undefined || range.endIndex === undefined || overviewData.length === 0) return;
        const startIndex = Math.max(0, Math.min(range.startIndex, overviewData.length - 1));
        const endIndex = Math.max(startIndex + 1, Math.min(range.endIndex, overviewData.length - 1));
        const start = overviewData[startIndex].time;
        const end = overviewData[endIndex].time;
        scheduleDomainUpdate(clampDomain([start, end]));
    };

    if (!sim || sim.timeH.length === 0) return (
        <div className="h-72 md:h-96 flex flex-col items-center justify-center glass-card rounded-2xl p-8" style={{ color: 'var(--text-tertiary)' }}>
            <Activity className="w-12 h-12 mb-4" style={{ color: 'var(--text-tertiary)' }} strokeWidth={1.5} />
            <p className="text-sm font-medium">{t('timeline.empty')}</p>
        </div>
    );

    const hasPersonalModel = hasE2Personal;

    return (
        <div className="glass-card rounded-2xl relative overflow-hidden flex flex-col">
            <div className="flex justify-between items-center px-4 md:px-6 py-3 md:py-4 border-b border-[var(--border-secondary)]">
                <h2 className="text-sm md:text-base font-semibold tracking-tight flex items-center gap-2" style={{ fontFamily: '-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif', color: 'var(--text-primary)' }}>
                    <span className="inline-flex items-center justify-center w-8 h-8 md:w-10 md:h-10 rounded-xl bg-pink-50 dark:bg-pink-950/30 border border-pink-100 dark:border-pink-800/30">
                        <Activity size={16} className="text-[#f6c4d7] md:w-5 md:h-5" />
                    </span>
                    {t('chart.title')}
                    {hasPersonalModel && (
                        <span className="ml-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-500 border border-rose-100">
                            {t('chart.personal_model')}
                        </span>
                    )}
                </h2>

                <div className="flex items-center gap-2">
                    <div className="flex bg-[var(--bg-secondary)] rounded-xl p-1 gap-1 border border-[var(--border-primary)]">
                        <button
                            onClick={() => zoomToDuration(30)}
                            className="px-3 py-1.5 text-xs md:text-sm font-bold rounded-lg hover:bg-[var(--bg-card)] transition-all" style={{ color: 'var(--text-secondary)' }}>
                            1M
                        </button>
                        <button
                            onClick={() => zoomToDuration(7)}
                            className="px-3 py-1.5 text-xs md:text-sm font-bold rounded-lg hover:bg-[var(--bg-card)] transition-all" style={{ color: 'var(--text-secondary)' }}>
                            1W
                        </button>
                        <div className="w-px h-4 self-center mx-1" style={{ background: 'var(--border-primary)' }}></div>
                        <button
                            onClick={() => {
                                zoomToDuration(7);
                            }}
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-card)] transition-all" style={{ color: 'var(--text-secondary)' }}
                        >
                            <RotateCcw size={14} className="md:w-4 md:h-4" />
                        </button>
                    </div>
                    {onShareImage && (
                        <button
                            onClick={onShareImage}
                            title="Share as Image"
                            aria-label="Share as Image"
                            className="p-1.5 rounded-lg hover:bg-[var(--bg-card-hover)] transition-all"
                            style={{ color: 'var(--text-secondary)' }}
                        >
                            <Camera size={16} className="md:w-[18px] md:h-[18px]" />
                        </button>
                    )}
                </div>
            </div>

            <div className="h-[36vh] min-h-[200px] max-h-[420px] md:h-80 lg:h-96 w-full touch-none relative select-none px-2 pb-2">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={data} margin={{ top: 28, right: 10, bottom: 0, left: 10 }}>
                        <defs>
                            <linearGradient id="colorConc" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f6c4d7" stopOpacity={0.18}/>
                                <stop offset="95%" stopColor="#f6c4d7" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="colorPersonal" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.12}/>
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border-secondary)" />
                        <XAxis
                            dataKey="time"
                            type="number"
                            domain={xDomain || ['auto', 'auto']}
                            allowDataOverflow={true}
                            tickFormatter={(ms) => formatDate(new Date(ms), lang)}
                            tick={{fontSize: 10, fill: 'var(--text-tertiary)', fontWeight: 600}}
                            minTickGap={48}
                            axisLine={false}
                            tickLine={false}
                            dy={10}
                        />
                        <YAxis
                            yAxisId="left"
                            dataKey="concE2"
                            domain={yAxisLeft.domain}
                            ticks={yAxisLeft.ticks}
                            allowDataOverflow={false}
                            allowDecimals={false}
                            tickFormatter={formatAxisTick}
                            tick={{fontSize: 10, fill: '#ec4899', fontWeight: 600}}
                            axisLine={false}
                            tickLine={false}
                            width={50}
                            label={{ value: 'E2 (pg/mL)', angle: -90, position: 'left', offset: 0, style: { fontSize: 11, fill: '#ec4899', fontWeight: 700, textAnchor: 'middle' } }}
                        />
                        {hasCPADoses && (
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            dataKey="concCPA"
                            domain={yAxisRight.domain}
                            ticks={yAxisRight.ticks}
                            tickFormatter={formatAxisTick}
                            tick={{fontSize: 10, fill: aaColor, fontWeight: 600}}
                            axisLine={false}
                            tickLine={false}
                            width={50}
                            label={{ value: `${aaLabel} (${aaUnit})`, angle: 90, position: 'right', offset: 0, style: { fontSize: 11, fill: aaColor, fontWeight: 700, textAnchor: 'middle' } }}
                        />
                        )}
                        {/* Hidden right axis when no CPA data — Recharts requires at least one yAxisId="right" */}
                        {!hasCPADoses && (
                        <YAxis
                            yAxisId="right"
                            orientation="right"
                            hide={true}
                            domain={[0, 1]}
                        />
                        )}
                        <Tooltip
                            content={<CustomTooltip t={t} lang={lang} aaLabel={aaLabel} aaUnit={aaUnit} aaColor={aaColor} aaShowPersonal={aaPersonalized} />}
                            cursor={{ stroke: '#f6c4d7', strokeWidth: 1, strokeDasharray: '4 4' }}
                            trigger="hover"
                        />
                        <ReferenceLine x={now} stroke="#f6c4d7" strokeDasharray="3 3" strokeWidth={1.2} yAxisId="left" />
                        {/* Endogenous baseline reference line — shown when a pre-dose baseline is
                            known but no personal model (post-dose learning) is active yet. */}
                        {!hasPersonalModel && baselineE2PGmL != null && baselineE2PGmL > 0 && (
                            <ReferenceLine
                                y={baselineE2PGmL}
                                yAxisId="left"
                                stroke="#14b8a6"
                                strokeDasharray="4 3"
                                strokeWidth={1.2}
                                label={{ value: `Endogenous ${baselineE2PGmL.toFixed(1)}`, position: 'insideTopLeft', fontSize: 9, fill: '#14b8a6', fontWeight: 600 }}
                            />
                        )}

                        {/* 95% CI band (stacked area: ci95Low base + ci95Band on top) */}
                        {hasPersonalModel && (
                            <>
                                <Area
                                    data={data}
                                    type="monotone"
                                    dataKey="ci95Low"
                                    yAxisId="left"
                                    stroke="none"
                                    fill="none"
                                    stackId="ci"
                                    isAnimationActive={false}
                                    dot={false}
                                    activeDot={false}
                                    legendType="none"
                                />
                                <Area
                                    data={data}
                                    type="monotone"
                                    dataKey="ci95Band"
                                    yAxisId="left"
                                    stroke="none"
                                    fill="rgba(244,63,94,0.09)"
                                    fillOpacity={1}
                                    stackId="ci"
                                    isAnimationActive={false}
                                    dot={false}
                                    activeDot={false}
                                    legendType="none"
                                />
                            </>
                        )}
                        {/* 68% CI band (inner band, darker — rendered above 95%) */}
                        {hasPersonalModel && (
                            <>
                                <Area
                                    data={data}
                                    type="monotone"
                                    dataKey="ci68Low"
                                    yAxisId="left"
                                    stroke="none"
                                    fill="none"
                                    stackId="ci68"
                                    isAnimationActive={false}
                                    dot={false}
                                    activeDot={false}
                                    legendType="none"
                                />
                                <Area
                                    data={data}
                                    type="monotone"
                                    dataKey="ci68Band"
                                    yAxisId="left"
                                    stroke="none"
                                    fill="rgba(244,63,94,0.17)"
                                    fillOpacity={1}
                                    stackId="ci68"
                                    isAnimationActive={false}
                                    dot={false}
                                    activeDot={false}
                                    legendType="none"
                                />
                            </>
                        )}
                        {hasPersonalCpaModel && hasPersonalCpaCI && hasCPADoses && (
                            <>
                                <Area
                                    data={data}
                                    type="monotone"
                                    dataKey="cpaCi95Low"
                                    yAxisId="right"
                                    stroke="none"
                                    fill="none"
                                    stackId="cpaCi"
                                    isAnimationActive={false}
                                    dot={false}
                                    activeDot={false}
                                    legendType="none"
                                />
                                <Area
                                    data={data}
                                    type="monotone"
                                    dataKey="cpaCi95Band"
                                    yAxisId="right"
                                    stroke="none"
                                    fill={`${aaColor}1A`}
                                    fillOpacity={1}
                                    stackId="cpaCi"
                                    isAnimationActive={false}
                                    dot={false}
                                    activeDot={false}
                                    legendType="none"
                                />
                            </>
                        )}

                        <Area
                            data={data}
                            type="monotone"
                            dataKey="concE2"
                            yAxisId="left"
                            stroke="#f6c4d7"
                            strokeWidth={2.2}
                            fillOpacity={0.95}
                            fill="url(#colorConc)"
                            isAnimationActive={false}
                            activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff', fill: '#ec4899' }}
                        />
                        {hasCPADoses && (
                        <Area
                            data={data}
                            type="monotone"
                            dataKey="concCPA"
                            yAxisId="right"
                            stroke={aaColor}
                            strokeWidth={2.2}
                            fillOpacity={0.12}
                            fill={aaColor}
                            isAnimationActive={false}
                            activeDot={{ r: 6, strokeWidth: 3, stroke: '#fff', fill: aaColor }}
                        />
                        )}

                        {/* Personal model E2 curve (dashed rose line) */}
                        {hasPersonalModel && (
                            <Area
                                data={data}
                                type="monotone"
                                dataKey="concPersonal"
                                yAxisId="left"
                                stroke="#f43f5e"
                                strokeWidth={1.8}
                                strokeDasharray="5 3"
                                fill="none"
                                isAnimationActive={false}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: '#f43f5e' }}
                            />
                        )}

                        {/* Personal model anti-androgen curve (dashed line) —
                            only for adherence-coupled compounds (CPA), not BICA. */}
                        {hasPersonalCpaModel && hasCPADoses && aaPersonalized && (
                            <Area
                                data={data}
                                type="monotone"
                                dataKey="concPersonalCPA"
                                yAxisId="right"
                                stroke={aaColor}
                                strokeWidth={1.8}
                                strokeDasharray="5 3"
                                fill="none"
                                isAnimationActive={false}
                                dot={false}
                                activeDot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: aaColor }}
                            />
                        )}

                        <Scatter
                            data={nowPoint ? [nowPoint] : []}
                            yAxisId="left"
                            isAnimationActive={false}
                            shape={({ cx, cy }: any) => {
                                return (
                                    <g className="group">
                                        <circle cx={cx} cy={cy} r={1} fill="transparent" />
                                        <circle
                                            cx={cx} cy={cy}
                                            r={4}
                                            fill="#bfdbfe"
                                            stroke="white"
                                            strokeWidth={1.5}
                                        />
                                    </g>
                                );
                            }}
                        />
                        {hasCPADoses && (
                        <Scatter
                            data={nowPoint ? [nowPoint] : []}
                            yAxisId="right"
                            isAnimationActive={false}
                            shape={({ cx, cy }: any) => {
                                return (
                                    <g className="group">
                                        <circle cx={cx} cy={cy} r={1} fill="transparent" />
                                        <circle
                                            cx={cx} cy={cy}
                                            r={4}
                                            fill={aaColor}
                                            stroke="white"
                                            strokeWidth={1.5}
                                        />
                                    </g>
                                );
                            }}
                        />
                        )}
                        {labPoints.map((point) => (
                            <ReferenceDot
                                key={`lab-visible-${point.id}`}
                                x={point.time}
                                y={point.conc}
                                yAxisId="left"
                                ifOverflow="extendDomain"
                                isFront={true}
                                r={9}
                                shape={({ cx, cy }: any) => {
                                    const x = cx ?? 0;
                                    const y = cy ?? 0;
                                    const iconSize = 10;
                                    const iconY = y - iconSize / 2 + 1;
                                    return (
                                        <g style={{ overflow: 'visible' }}>
                                            <circle cx={x} cy={y} r={9} fill="#14b8a6" stroke="white" strokeWidth={2} />
                                            <svg
                                                x={x - iconSize / 2}
                                                y={iconY}
                                                width={iconSize}
                                                height={iconSize}
                                                viewBox="0 0 24 24"
                                                fill="none"
                                                stroke="white"
                                                strokeWidth={2.25}
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                overflow="visible"
                                            >
                                                <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
                                                <path d="M8.5 2h7" />
                                                <path d="M7 16h10" />
                                            </svg>
                                        </g>
                                    );
                                }}
                            />
                        ))}
                        {labPoints.length > 0 && (
                            <Scatter
                                data={labPoints}
                                dataKey="conc"
                                yAxisId="left"
                                isAnimationActive={false}
                                shape={({ cx, cy }: any) => (
                                    <circle cx={cx} cy={cy} r={10} fill="transparent" />
                                )}
                            />
                        )}
                        {/* Dose event markers — small dots on the E2 curve */}
                        {dosePoints.length > 0 && (
                            <Scatter
                                data={dosePoints}
                                dataKey="concE2"
                                yAxisId="left"
                                isAnimationActive={false}
                                shape={({ cx, cy, payload }: any) => (
                                    <g>
                                        <circle
                                            cx={cx}
                                            cy={cy}
                                            r={3}
                                            fill={payload?.ester && isAntiandrogen(payload.ester) ? (ANTIANDROGENS[payload.ester as Ester]?.color ?? '#8b5cf6') : '#ec4899'}
                                            stroke="white"
                                            strokeWidth={1.5}
                                        />
                                    </g>
                                )}
                            />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            {/* Overview mini-map with draggable handles */}
            {overviewData.length > 1 && (
                <div
                    className="px-3 pb-4 mt-1 touch-none select-none"
                    style={{ touchAction: 'none', overscrollBehavior: 'contain' }}
                    onTouchMoveCapture={(e) => e.preventDefault()}
                >
                    <div className="w-full h-16 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-none shadow-inner overflow-hidden">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={overviewData} margin={{ top: 6, right: 8, left: -6, bottom: 6 }}>
                                <defs>
                                    <linearGradient id="overviewConc" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#bfdbfe" stopOpacity={0.28}/>
                                        <stop offset="95%" stopColor="#bfdbfe" stopOpacity={0}/>
                                    </linearGradient>
                                </defs>
                                <XAxis
                                    dataKey="time"
                                    type="number"
                                    hide
                                    domain={[minTime, maxTime]}
                                />
                                <YAxis dataKey="concE2" hide />
                                <Area
                                    type="monotone"
                                    dataKey="concE2"
                                    stroke="#bfdbfe"
                                    strokeWidth={1.2}
                                    fill="url(#overviewConc)"
                                    isAnimationActive={false}
                                />
                                <Brush
                                    dataKey="time"
                                    height={22}
                                    stroke="#bfdbfe"
                                    startIndex={brushRange.startIndex}
                                    endIndex={brushRange.endIndex}
                                    gap={10}
                                    travellerWidth={12}
                                    tickFormatter={(ms) => formatDate(new Date(ms), lang)}
                                    onChange={handleBrushChange}
                                >
                                    <Area
                                        type="monotone"
                                        dataKey="concE2"
                                        stroke="#93c5fd"
                                        fill="#bfdbfe"
                                        fillOpacity={0.15}
                                        isAnimationActive={false}
                                    />
                                </Brush>
                            </AreaChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ResultChart;
