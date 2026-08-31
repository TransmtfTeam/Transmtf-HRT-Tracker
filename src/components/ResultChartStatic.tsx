/**
 * ResultChartStatic — a static, non-interactive version of ResultChart
 * for use in the share image export. No Brush, no Tooltip, no zoom controls.
 * Fixed pixel dimensions for A4 landscape at ~150 dpi.
 */
import React, { useMemo } from 'react';
import {
    XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceDot,
    Area, AreaChart, ComposedChart, Scatter
} from 'recharts';
import { SimulationResult, DoseEvent, LabResult, interpolateConcentration_E2, interpolateCompoundConcentration, isAntiandrogen, pickPrimaryAntiandrogen, ANTIANDROGENS, Ester, convertToPgMl } from '../../logic';
import { formatDate } from '../utils/helpers';
import { calculateNiceAxis } from '../utils/chartAxis';

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
    ci68Low?: number;
    ci68Band?: number;
    cpaCi95Low?: number;
    cpaCi95Band?: number;
}

function interpAt(timeH: number[], values: number[], h: number): number | undefined {
    if (!timeH.length || !values.length) return undefined;
    if (h <= timeH[0]) return values[0];
    if (h >= timeH[timeH.length - 1]) return values[values.length - 1];
    let lo = 0, hi = timeH.length - 1;
    while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (timeH[mid] <= h) lo = mid; else hi = mid;
    }
    const frac = (timeH[hi] - timeH[lo]) > 0 ? (h - timeH[lo]) / (timeH[hi] - timeH[lo]) : 0;
    const v = values[lo] + frac * (values[hi] - values[lo]);
    return isFinite(v) ? v : undefined;
}

function formatAxisTick(raw: any): string {
    const n = Number(raw);
    if (!isFinite(n) || n < 0) return '0';
    if (n >= 10) return `${Math.round(n)}`;
    if (n >= 1) return n.toFixed(1);
    return n.toFixed(2);
}

const CHART_WIDTH_DEFAULT = 2100;
const CHART_HEIGHT_DEFAULT = 900;
const E2_FALLBACK_MAX = 10;
const CPA_FALLBACK_MAX = 1;
const AXIS_TICK_COUNT = 4;
const MAX_POINTS = 600;

function downsample(series: ChartPoint[], maxPts: number): ChartPoint[] {
    if (series.length <= maxPts) return series;
    const result: ChartPoint[] = [series[0]];
    const step = (series.length - 1) / (maxPts - 1);
    for (let i = 1; i < maxPts - 1; i++) {
        result.push(series[Math.round(i * step)]);
    }
    result.push(series[series.length - 1]);
    return result;
}

interface Props {
    sim: SimulationResult | null;
    events: DoseEvent[];
    labResults: LabResult[];
    simCI?: SimCI | null;
    baselineE2PGmL?: number | null;
    xDomain?: [number, number] | null;
    nowH?: number;
    width?: number;
    height?: number;
    isDark?: boolean;
    themeColors?: { 50: string; 100: string; 200: string; 300: string; 400: string; 500: string; 600: string };
}

const ResultChartStatic: React.FC<Props> = ({ sim, events, labResults, simCI, baselineE2PGmL, xDomain, nowH, width, height, isDark = false, themeColors }) => {
    const primaryAA = useMemo<Ester | null>(
        () => pickPrimaryAntiandrogen(events, nowH ?? Date.now() / 3600000),
        [events, nowH]
    );
    const aaSpec = primaryAA ? ANTIANDROGENS[primaryAA]! : null;
    const hasCPADoses = !!primaryAA;
    const aaUnit: 'ng/mL' | 'ug/mL' = primaryAA === Ester.BICA ? 'ug/mL' : 'ng/mL';
    const aaScale = aaUnit === 'ug/mL' ? 1 / 1000 : 1;
    const aaColor = aaSpec?.color ?? '#8b5cf6';
    const aaLabel = primaryAA ?? 'CPA';
    const aaPersonalized = !!aaSpec?.adherenceFromE2;

    const hasPersonalModel = !!simCI && simCI.e2Adjusted.length > 0;
    const aaCISeries = (primaryAA && simCI) ? simCI.antiandrogen[primaryAA] : undefined;
    const hasPersonalCpaModel = !!aaCISeries && !!simCI && aaCISeries.adjusted.length === simCI.timeH.length && aaCISeries.adjusted.length > 0;
    const hasPersonalCpaCI = !!aaCISeries && !!simCI && aaCISeries.ci95Low.length === simCI.timeH.length;

    const rawData = useMemo<ChartPoint[]>(() => {
        if (!sim || sim.timeH.length === 0) return [];
        const baseShift = (!hasPersonalModel && baselineE2PGmL && baselineE2PGmL > 0) ? baselineE2PGmL : 0;
        const aaSeries = primaryAA ? sim.byCompound?.[primaryAA] : undefined;
        return sim.timeH.map((t, i) => {
            const timeMs = t * 3600000;
            const baseE2 = sim.concPGmL_E2[i] + baseShift;
            const rawCPA = (aaSeries ? aaSeries.values[i] : 0) * aaScale;
            const ci95Low = simCI ? interpAt(simCI.timeH, simCI.ci95Low, t) : undefined;
            const ci95High = simCI ? interpAt(simCI.timeH, simCI.ci95High, t) : undefined;
            const ci68Low = simCI ? interpAt(simCI.timeH, simCI.ci68Low, t) : undefined;
            const ci68High = simCI ? interpAt(simCI.timeH, simCI.ci68High, t) : undefined;
            const concPersonal = simCI ? interpAt(simCI.timeH, simCI.e2Adjusted, t) : undefined;
            const concPersonalCPA = (hasPersonalCpaModel && aaCISeries) ? interpAt(simCI!.timeH, aaCISeries.adjusted, t)! * aaScale : undefined;
            const cpaCi95Low = (hasPersonalCpaCI && aaCISeries) ? interpAt(simCI!.timeH, aaCISeries.ci95Low, t)! * aaScale : undefined;
            const cpaCi95High = (hasPersonalCpaCI && aaCISeries) ? interpAt(simCI!.timeH, aaCISeries.ci95High, t)! * aaScale : undefined;
            return {
                time: timeMs,
                concE2: baseE2,
                concCPA: rawCPA,
                concPersonal,
                concPersonalCPA,
                ci95Low,
                ci95Band: (ci95Low !== undefined && ci95High !== undefined) ? Math.max(0, ci95High - ci95Low) : undefined,
                ci68Low,
                ci68Band: (ci68Low !== undefined && ci68High !== undefined) ? Math.max(0, ci68High - ci68Low) : undefined,
                cpaCi95Low,
                cpaCi95Band: (cpaCi95Low !== undefined && cpaCi95High !== undefined) ? Math.max(0, cpaCi95High - cpaCi95Low) : undefined,
            };
        });
    }, [sim, simCI, hasPersonalModel, hasPersonalCpaModel, hasPersonalCpaCI, baselineE2PGmL, primaryAA, aaCISeries, aaScale]);

    // ① Filter to xDomain FIRST so the downsample respects the user-selected window.
    // Include a small pad (one sample each side) so the line renders smoothly at the edges.
    const filteredData = useMemo(() => {
        if (!xDomain || rawData.length === 0) return rawData;
        const [lo, hi] = xDomain;
        // Find first index >= lo and last index <= hi
        let firstIdx = rawData.findIndex(d => d.time >= lo);
        if (firstIdx === -1) firstIdx = rawData.length - 1;
        let lastIdx = rawData.length - 1;
        for (let i = rawData.length - 1; i >= 0; i--) {
            if (rawData[i].time <= hi) { lastIdx = i; break; }
        }
        // Pad by one sample on each side to preserve line continuity
        const startIdx = Math.max(0, firstIdx - 1);
        const endIdx = Math.min(rawData.length - 1, lastIdx + 1);
        return rawData.slice(startIdx, endIdx + 1);
    }, [rawData, xDomain]);

    const data = useMemo(() => downsample(filteredData, MAX_POINTS), [filteredData]);

    const labPoints = useMemo(() => {
        if (!labResults || !labResults.length) return [];
        return labResults.map(l => ({
            time: l.timeH * 3600000,
            conc: convertToPgMl(l.concValue, l.unit),
            isLabResult: true,
            id: l.id,
        }));
    }, [labResults]);

    const dosePoints = useMemo(() => {
        if (!sim || !events.length) return [];
        const baseShift = (!hasPersonalModel && baselineE2PGmL && baselineE2PGmL > 0) ? baselineE2PGmL : 0;
        return events.map(e => {
            const concE2Raw = interpolateConcentration_E2(sim, e.timeH);
            const concE2 = concE2Raw !== null && !isNaN(concE2Raw) ? concE2Raw + baseShift : 0;
            return { time: e.timeH * 3600000, concE2, ester: e.ester };
        });
    }, [events, sim, hasPersonalModel, baselineE2PGmL]);

    const now = Date.now();
    const minTime = xDomain ? xDomain[0] : (data.length ? data[0].time : now);
    const maxTime = xDomain ? xDomain[1] : (data.length ? data[data.length - 1].time : now);

    // data is already filtered to xDomain, so use it directly for Y-domain computation
    const visibleData = data;

    // Y domains
    let e2Peak = E2_FALLBACK_MAX;
    for (const d of visibleData) {
        if (d.concE2 && d.concE2 > e2Peak) e2Peak = d.concE2;
        if (d.concPersonal && d.concPersonal > e2Peak) e2Peak = d.concPersonal;
    }
    for (const l of labPoints) {
        if (l.time >= minTime && l.time <= maxTime && l.conc > e2Peak) e2Peak = l.conc;
    }
    const yAxisLeft = calculateNiceAxis(0, e2Peak * 1.15, AXIS_TICK_COUNT, E2_FALLBACK_MAX);

    let cpaPeak = CPA_FALLBACK_MAX;
    for (const d of visibleData) {
        if (d.concCPA && d.concCPA > cpaPeak) cpaPeak = d.concCPA;
        if (d.concPersonalCPA && d.concPersonalCPA > cpaPeak) cpaPeak = d.concPersonalCPA;
        if (d.cpaCi95Band !== undefined && d.cpaCi95Low !== undefined) {
            const ciHigh = d.cpaCi95Low + d.cpaCi95Band;
            if (ciHigh > cpaPeak) cpaPeak = ciHigh;
        }
    }
    const yAxisRight = calculateNiceAxis(0, cpaPeak * 1.15, AXIS_TICK_COUNT, CPA_FALLBACK_MAX);

    const nowPoint = useMemo(() => {
        if (!sim || !data.length) return null;
        const h = now / 3600000;
        const concE2Raw = interpolateConcentration_E2(sim, h);
        const concCPA = primaryAA ? interpolateCompoundConcentration(sim, primaryAA, h) : null;
        if (concE2Raw === null && concCPA === null) return null;
        const baseShift = (!hasPersonalModel && baselineE2PGmL && baselineE2PGmL > 0) ? baselineE2PGmL : 0;
        return {
            time: now,
            concE2: concE2Raw ? concE2Raw + baseShift : 0,
            concCPA: (concCPA || 0) * aaScale,
        };
    }, [sim, data, now, hasPersonalModel, baselineE2PGmL, primaryAA, aaScale]);

    if (!sim || data.length === 0) return null;

    // Theme-aware colors
    const accent500 = themeColors?.[500] ?? '#f43f5e';
    const accent300 = themeColors?.[300] ?? '#fda4af';
    const gridColor = isDark ? '#1e293b' : '#e2e8f0';
    const tickColorX = isDark ? '#64748b' : '#94a3b8';
    const tickColorE2 = accent500;
    const nowLineColor = isDark ? `${accent500}80` : accent300;

    return (
        <ComposedChart
            width={width ?? CHART_WIDTH_DEFAULT}
            height={height ?? CHART_HEIGHT_DEFAULT}
            data={data}
            margin={{ top: 32, right: 80, bottom: 16, left: 80 }}
            style={{ background: 'transparent' }}
        >
            <defs>
                <linearGradient id="sColorConc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={accent500} stopOpacity={0.22} />
                    <stop offset="95%" stopColor={accent500} stopOpacity={0} />
                </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={gridColor} />
            <XAxis
                dataKey="time"
                type="number"
                domain={[minTime, maxTime]}
                allowDataOverflow={true}
                tickFormatter={(ms) => formatDate(new Date(ms), 'en')}
                tick={{ fontSize: 18, fill: tickColorX, fontWeight: 600 }}
                minTickGap={80}
                axisLine={false}
                tickLine={false}
                dy={10}
            />
            <YAxis
                yAxisId="left"
                domain={yAxisLeft.domain}
                ticks={yAxisLeft.ticks}
                tickFormatter={formatAxisTick}
                tick={{ fontSize: 18, fill: tickColorE2, fontWeight: 600 }}
                axisLine={false}
                tickLine={false}
                width={70}
                label={{ value: 'E2 (pg/mL)', angle: -90, position: 'left', offset: 0, style: { fontSize: 16, fill: tickColorE2, fontWeight: 700, textAnchor: 'middle' } }}
            />
            {hasCPADoses ? (
                <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={yAxisRight.domain}
                    ticks={yAxisRight.ticks}
                    tickFormatter={formatAxisTick}
                    tick={{ fontSize: 18, fill: aaColor, fontWeight: 600 }}
                    axisLine={false}
                    tickLine={false}
                    width={70}
                    label={{ value: `${aaLabel} (${aaUnit})`, angle: 90, position: 'right', offset: 0, style: { fontSize: 16, fill: aaColor, fontWeight: 700, textAnchor: 'middle' } }}
                />
            ) : (
                <YAxis yAxisId="right" orientation="right" hide domain={[0, 1]} />
            )}
            <ReferenceLine x={now} stroke={nowLineColor} strokeDasharray="4 4" strokeWidth={2} yAxisId="left" />
            {!hasPersonalModel && baselineE2PGmL != null && baselineE2PGmL > 0 && (
                <ReferenceLine
                    y={baselineE2PGmL}
                    yAxisId="left"
                    stroke="#14b8a6"
                    strokeDasharray="4 3"
                    strokeWidth={2}
                    label={{ value: `Endogenous ${baselineE2PGmL.toFixed(1)}`, position: 'insideTopLeft', fontSize: 14, fill: '#14b8a6', fontWeight: 600 }}
                />
            )}

            {/* CI bands */}
            {hasPersonalModel && (
                <>
                    <Area data={data} type="monotone" dataKey="ci95Low" yAxisId="left" stroke="none" fill="none" stackId="ci" isAnimationActive={false} dot={false} activeDot={false} legendType="none" />
                    <Area data={data} type="monotone" dataKey="ci95Band" yAxisId="left" stroke="none" fill={`${accent500}18`} fillOpacity={1} stackId="ci" isAnimationActive={false} dot={false} activeDot={false} legendType="none" />
                    <Area data={data} type="monotone" dataKey="ci68Low" yAxisId="left" stroke="none" fill="none" stackId="ci68" isAnimationActive={false} dot={false} activeDot={false} legendType="none" />
                    <Area data={data} type="monotone" dataKey="ci68Band" yAxisId="left" stroke="none" fill={`${accent500}30`} fillOpacity={1} stackId="ci68" isAnimationActive={false} dot={false} activeDot={false} legendType="none" />
                </>
            )}
            {hasPersonalCpaModel && hasPersonalCpaCI && hasCPADoses && (
                <>
                    <Area data={data} type="monotone" dataKey="cpaCi95Low" yAxisId="right" stroke="none" fill="none" stackId="cpaCi" isAnimationActive={false} dot={false} activeDot={false} legendType="none" />
                    <Area data={data} type="monotone" dataKey="cpaCi95Band" yAxisId="right" stroke="none" fill={`${aaColor}1A`} fillOpacity={1} stackId="cpaCi" isAnimationActive={false} dot={false} activeDot={false} legendType="none" />
                </>
            )}

            {/* Main curves */}
            <Area data={data} type="monotone" dataKey="concE2" yAxisId="left" stroke={accent300} strokeWidth={3} fillOpacity={0.95} fill="url(#sColorConc)" isAnimationActive={false} dot={false} activeDot={false} />
            {hasCPADoses && (
                <Area data={data} type="monotone" dataKey="concCPA" yAxisId="right" stroke={aaColor} strokeWidth={3} fillOpacity={0.12} fill={aaColor} isAnimationActive={false} dot={false} activeDot={false} />
            )}
            {hasPersonalModel && (
                <Area data={data} type="monotone" dataKey="concPersonal" yAxisId="left" stroke={accent500} strokeWidth={2.5} strokeDasharray="6 3" fill="none" isAnimationActive={false} dot={false} activeDot={false} />
            )}
            {hasPersonalCpaModel && hasCPADoses && aaPersonalized && (
                <Area data={data} type="monotone" dataKey="concPersonalCPA" yAxisId="right" stroke={aaColor} strokeWidth={2.5} strokeDasharray="6 3" fill="none" isAnimationActive={false} dot={false} activeDot={false} />
            )}

            {/* Now dot */}
            <Scatter data={nowPoint ? [nowPoint] : []} yAxisId="left" isAnimationActive={false}
                shape={({ cx, cy }: any) => (
                    <circle cx={cx} cy={cy} r={8} fill="#bfdbfe" stroke="white" strokeWidth={2.5} />
                )}
            />
            {hasCPADoses && (
                <Scatter data={nowPoint ? [nowPoint] : []} yAxisId="right" isAnimationActive={false}
                    shape={({ cx, cy }: any) => (
                        <circle cx={cx} cy={cy} r={8} fill={aaColor} stroke="white" strokeWidth={2.5} />
                    )}
                />
            )}

            {/* Lab result dots */}
            {labPoints.map((point) => (
                <ReferenceDot
                    key={`slab-${point.id}`}
                    x={point.time}
                    y={point.conc}
                    yAxisId="left"
                    ifOverflow="extendDomain"
                    isFront
                    r={14}
                    shape={({ cx, cy }: any) => {
                        const x = cx ?? 0; const y = cy ?? 0;
                        return (
                            <g><circle cx={x} cy={y} r={14} fill="#14b8a6" stroke="white" strokeWidth={3} /></g>
                        );
                    }}
                />
            ))}

            {/* Dose event dots */}
            {dosePoints.length > 0 && (
                <Scatter data={dosePoints} dataKey="concE2" yAxisId="left" isAnimationActive={false}
                    shape={({ cx, cy, payload }: any) => (
                        <circle cx={cx} cy={cy} r={5} fill={payload?.ester && isAntiandrogen(payload.ester) ? (ANTIANDROGENS[payload.ester as Ester]?.color ?? '#8b5cf6') : '#ec4899'} stroke="white" strokeWidth={2} />
                    )}
                />
            )}
        </ComposedChart>
    );
};

export default ResultChartStatic;
