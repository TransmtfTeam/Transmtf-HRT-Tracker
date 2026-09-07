type HashableData = {
    events: unknown[];
    weight: number;
    labResults: unknown[];
    lang?: string;
    calibrationModel?: string;
    calibrationMode?: string;
    applyE2LearningToCPA?: boolean;
    applyCPAInhibitionToE2?: boolean;
    themeColor?: string;
    themeMode?: string;
    darkMode?: boolean;
    gelProducts?: unknown[];
};

// Bump this whenever the synced field set changes. The hash is prefixed with it
// so the sync layer can tell "data changed" apart from "hash formula changed"
// (an old baseline hash with a different prefix must NOT be read as a local edit).
export const SYNC_HASH_SCHEMA = 'v4';

/**
 * Canonical projection of the synced fields to their default values. Shared by
 * `computeDataHash` AND the conflict diff so that an absent field (e.g. an older
 * client that never wrote `gelProducts`) compares equal to the local default
 * rather than registering as a spurious difference.
 */
/**
 * Single source of truth for reading a theme mode out of a snapshot, local or
 * remote. Snapshots written by clients that predate `themeMode` only carry the
 * boolean `darkMode`, so they are mapped onto the equivalent explicit mode.
 */
export const resolveThemeMode = (data: Pick<HashableData, 'themeMode' | 'darkMode'>): string =>
    data.themeMode === 'system' || data.themeMode === 'light' || data.themeMode === 'dark'
        ? data.themeMode
        : data.darkMode ? 'dark' : 'light';

export const projectForSync = (data: Partial<HashableData>): Record<string, unknown> => ({
    events: data.events || [],
    weight: Number.isFinite(data.weight as number) ? (data.weight as number) : 0,
    labResults: data.labResults || [],
    lang: data.lang || '',
    calibrationModel: data.calibrationModel || '',
    calibrationMode: data.calibrationMode || '',
    applyE2LearningToCPA: data.applyE2LearningToCPA ?? false,
    applyCPAInhibitionToE2: data.applyCPAInhibitionToE2 ?? false,
    themeColor: data.themeColor || '',
    themeMode: resolveThemeMode(data),
    // `darkMode` is deliberately absent. Under the "system" mode it is derived
    // from each device's own prefers-color-scheme, so two devices holding the
    // very same setting would hash differently and raise a phantom conflict.
    // It is still persisted and uploaded for older clients - just not compared.
    gelProducts: data.gelProducts || [],
});

const stableStringify = (value: unknown): string => {
    if (value === null || value === undefined) {
        return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>;
        const keys = Object.keys(obj).sort();
        const entries = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
        return `{${entries.join(',')}}`;
    }
    return JSON.stringify(value);
};

const hashString = (input: string): string => {
    let hash = 5381;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash * 33) ^ input.charCodeAt(i);
    }
    return (hash >>> 0).toString(16);
};

export const computeDataHash = (data: HashableData): string =>
    `${SYNC_HASH_SCHEMA}:${hashString(stableStringify(projectForSync(data)))}`;
