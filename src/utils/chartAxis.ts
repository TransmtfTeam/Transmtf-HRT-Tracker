import { scaleLinear } from 'd3-scale';

/**
 * Suggest a non-negative linear axis range using D3's nice-tick algorithm.
 *
 * This produces the axis *bounds* only. Recharts is left to generate the ticks
 * from whatever domain it finally settles on, because it - not this function -
 * decides that domain: with `allowDataOverflow` off it widens the suggestion to
 * cover anything plotted that the caller did not account for. Ticks computed
 * here would describe the suggestion rather than the result, and would sit in
 * the wrong place whenever the two differ.
 *
 * `allowDecimals` mirrors the Recharts prop: pass `false` for an axis that
 * should read in whole units, so the bounds land on integers and the ticks
 * Recharts fits inside them can too.
 */
export function calculateNiceDomain(
    min: number,
    max: number,
    tickCount = 4,
    fallbackMax = 10,
    allowDecimals = true,
): [number, number] {
    const safeFallback = Number.isFinite(fallbackMax) && fallbackMax > 0 ? fallbackMax : 1;
    let safeMax = Number.isFinite(max) && max > 0 ? max : safeFallback;
    let safeMin = Number.isFinite(min) && min >= 0 && min < safeMax ? min : 0;
    const count = Number.isFinite(tickCount) ? Math.max(2, Math.floor(tickCount)) : 4;

    if (!allowDecimals) {
        // Snap to whole numbers and hold the span at `count` units or more. D3
        // derives its step from span / count, so a span that wide keeps the step
        // at 1 or above, which lands both niced bounds on integers.
        safeMin = Math.floor(safeMin);
        safeMax = Math.max(Math.ceil(safeMax), safeMin + count);
    }

    const [lo, hi] = scaleLinear().domain([safeMin, safeMax]).nice(count).domain();
    return [lo, hi];
}
