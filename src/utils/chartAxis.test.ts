import { describe, expect, it } from 'vitest';
import { calculateNiceAxis } from './chartAxis';

describe('chart axis', () => {
    it.each([
        [522, 600],
        [784, 800],
        [2856, 3000],
    ])('uses a compact nice upper bound for %s', (max, expectedMax) => {
        expect(calculateNiceAxis(0, max, 4).domain[1]).toBe(expectedMax);
    });

    it('falls back safely when the maximum is invalid', () => {
        expect(calculateNiceAxis(0, Number.NaN, 4, 10).domain).toEqual([0, 10]);
    });
});
