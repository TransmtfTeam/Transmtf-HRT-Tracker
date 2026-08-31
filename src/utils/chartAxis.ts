import { scaleLinear } from 'd3-scale';

export interface NiceAxis {
    domain: [number, number];
    ticks: number[];
}

/** Build a non-negative linear axis with D3's standard nice-tick algorithm. */
export function calculateNiceAxis(
    min: number,
    max: number,
    tickCount = 4,
    fallbackMax = 10,
): NiceAxis {
    const safeFallback = Number.isFinite(fallbackMax) && fallbackMax > 0 ? fallbackMax : 1;
    const safeMax = Number.isFinite(max) && max > 0 ? max : safeFallback;
    const safeMin = Number.isFinite(min) && min >= 0 && min < safeMax ? min : 0;
    const count = Number.isFinite(tickCount) ? Math.max(2, Math.floor(tickCount)) : 4;
    const scale = scaleLinear().domain([safeMin, safeMax]).nice(count);
    const domain = scale.domain();

    return {
        domain: [domain[0], domain[1]],
        ticks: scale.ticks(count),
    };
}
