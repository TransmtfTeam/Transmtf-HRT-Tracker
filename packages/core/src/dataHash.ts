export type HashableData = {
    events: unknown[];
    weight: number;
    labResults: unknown[];
    lang?: string;
    calibrationModel?: string;
    applyE2LearningToCPA?: boolean;
    applyCPAInhibitionToE2?: boolean;
};

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

export const computeDataHash = (data: HashableData): string => {
    const payload = {
        events: data.events || [],
        weight: Number.isFinite(data.weight) ? data.weight : 0,
        labResults: data.labResults || [],
        lang: data.lang || '',
        calibrationModel: data.calibrationModel || '',
        applyE2LearningToCPA: data.applyE2LearningToCPA ?? false,
        applyCPAInhibitionToE2: data.applyCPAInhibitionToE2 ?? false,
    };
    return hashString(stableStringify(payload));
};
