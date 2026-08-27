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
    themeMode: data.themeMode || (data.darkMode ? 'dark' : 'light'),
    darkMode: data.darkMode ?? false,
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
