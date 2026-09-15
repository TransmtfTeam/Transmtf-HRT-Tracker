import { describe, it, expect } from 'vitest';
import { computeDataHash, projectForSync, SYNC_HASH_SCHEMA } from './dataHash';

const base = { events: [], weight: 70, labResults: [] };

describe('computeDataHash schema versioning', () => {
    it('prefixes the hash with the current schema tag', () => {
        const h = computeDataHash(base);
        expect(h.startsWith(SYNC_HASH_SCHEMA + ':')).toBe(true);
    });

    it('treats an absent gelProducts as equal to an empty list (projection normalization)', () => {
        const absent = computeDataHash(base);
        const empty = computeDataHash({ ...base, gelProducts: [] });
        expect(absent).toBe(empty);
    });

    it('changes when a synced field actually changes', () => {
        const a = computeDataHash(base);
        const b = computeDataHash({ ...base, gelProducts: [{ id: 1000 }] });
        expect(a).not.toBe(b);
    });

    it('projects exactly the synced fields with defaults', () => {
        const p = projectForSync({});
        expect(Object.keys(p).sort()).toEqual([
            'applyCPAInhibitionToE2',
            'applyE2LearningToCPA',
            'calibrationMode',
            'calibrationModel',
            'events',
            'gelProducts',
            'labResults',
            'lang',
            'themeColor',
            'weight',
        ]);
        expect(p.gelProducts).toEqual([]);
        expect(p.themeColor).toBe('');
        expect(p.weight).toBe(0);
    });
});
