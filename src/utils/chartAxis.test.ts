import { describe, expect, it } from 'vitest';
import { calculateNiceDomain } from './chartAxis';

describe('chart axis domain', () => {
    it.each([
        [522, 600],
        [784, 800],
        [2856, 3000],
    ])('uses a compact nice upper bound for %s', (max, expectedMax) => {
        // The old niceCeil jumped a whole order of magnitude here - 522 became
        // 1000 - leaving most of the plot empty.
        expect(calculateNiceDomain(0, max, 4)[1]).toBe(expectedMax);
    });

    it('falls back safely when the maximum is invalid', () => {
        expect(calculateNiceDomain(0, Number.NaN, 4, 10)).toEqual([0, 10]);
        expect(calculateNiceDomain(0, Number.POSITIVE_INFINITY, 4, 10)).toEqual([0, 10]);
        expect(calculateNiceDomain(0, -5, 4, 10)).toEqual([0, 10]);
    });

    it('never clips the requested range', () => {
        for (const [min, max] of [[0, 10], [95, 157], [510, 1008], [12, 14], [0, 0.4]]) {
            const [lo, hi] = calculateNiceDomain(min, max, 4);
            expect(lo).toBeLessThanOrEqual(min);
            expect(hi).toBeGreaterThanOrEqual(max);
        }
    });

    it('stays non-negative and non-degenerate across a sweep', () => {
        for (let max = 1; max <= 3000; max += 7) {
            const [lo, hi] = calculateNiceDomain(0, max, 4);
            expect(lo).toBeGreaterThanOrEqual(0);
            expect(hi).toBeGreaterThan(lo);
        }
    });

    describe('allowDecimals: false', () => {
        it('lands both bounds on integers across a wide sweep', () => {
            for (let min = 0; min <= 40; min += 1) {
                for (const span of [0.4, 1.2, 2.5, 4, 9.7, 25, 140]) {
                    const [lo, hi] = calculateNiceDomain(min, min + span, 4, 10, false);
                    expect(Number.isInteger(lo)).toBe(true);
                    expect(Number.isInteger(hi)).toBe(true);
                    expect(lo).toBeLessThanOrEqual(min);
                    expect(hi).toBeGreaterThanOrEqual(min + span);
                }
            }
        });

        it('leaves room for more than one whole-unit tick in a narrow range', () => {
            // E2 sitting around 10-12 used to collapse onto a sub-unit range,
            // which an integer axis cannot label without repeating itself.
            const [lo, hi] = calculateNiceDomain(10, 11.2, 4, 10, false);
            expect(hi - lo).toBeGreaterThanOrEqual(4);
        });

        it('leaves large ranges untouched', () => {
            expect(calculateNiceDomain(0, 522, 4, 10, false)[1]).toBe(600);
        });
    });
});
