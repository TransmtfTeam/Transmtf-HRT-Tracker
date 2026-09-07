import { describe, it, expect } from 'vitest';
import { computeDataHash, projectForSync, resolveThemeMode, SYNC_HASH_SCHEMA } from './dataHash';

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

    it('projectForSync fills every synced field with a default', () => {
        const p = projectForSync({});
        expect(p.gelProducts).toEqual([]);
        expect(p.themeMode).toBe('light');
        expect(p.themeColor).toBe('');
        expect(p.weight).toBe(0);
    });
});

describe('theme mode normalization', () => {
    it('maps a pre-themeMode snapshot onto the equivalent explicit mode', () => {
        expect(resolveThemeMode({ darkMode: true })).toBe('dark');
        expect(resolveThemeMode({ darkMode: false })).toBe('light');
        expect(resolveThemeMode({})).toBe('light');
    });

    it('prefers an explicit themeMode and rejects junk values', () => {
        expect(resolveThemeMode({ themeMode: 'system', darkMode: false })).toBe('system');
        expect(resolveThemeMode({ themeMode: 'dark', darkMode: false })).toBe('dark');
        expect(resolveThemeMode({ themeMode: 'nonsense', darkMode: true })).toBe('dark');
    });

    it('hashes an upgraded client the same as the legacy snapshot it came from', () => {
        const legacy = computeDataHash({ ...base, darkMode: true });
        const upgraded = computeDataHash({ ...base, themeMode: 'dark', darkMode: true });
        expect(upgraded).toBe(legacy);
    });

    it('ignores darkMode so two devices on "system" agree despite differing OS themes', () => {
        // darkMode is derived from each device's prefers-color-scheme, so folding
        // it into the hash would surface a conflict between devices that in fact
        // hold the very same setting.
        const lightDevice = computeDataHash({ ...base, themeMode: 'system', darkMode: false });
        const darkDevice = computeDataHash({ ...base, themeMode: 'system', darkMode: true });
        expect(lightDevice).toBe(darkDevice);
    });

    it('still reacts to a real change of mode', () => {
        const system = computeDataHash({ ...base, themeMode: 'system' });
        const dark = computeDataHash({ ...base, themeMode: 'dark' });
        expect(system).not.toBe(dark);
    });
});
