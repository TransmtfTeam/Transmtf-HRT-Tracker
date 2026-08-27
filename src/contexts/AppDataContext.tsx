import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode, useRef, useCallback } from 'react';
import {
    DoseEvent, LabResult, SimulationResult,
    PersonalModelState, EKFDiagnostics, CalibrationModel, CalibrationMode,
    runSimulation, createCalibrationInterpolator,
    replayPersonalModel, computeSimulationWithCI, initPersonalModel,
    ekfUpdatePersonalModel, isAntiandrogen, GelProductSpec, setCustomGelProducts,
} from '../../logic';
import { computeDataHash } from '../utils/dataHash';
import { GEL_PRODUCTS_KEY, readCustomGelProducts, writeCustomGelProducts } from '../utils/doseForm';
import { backfillEventWeights, eventsNeedWeightMigration, latestEventWeight, DEFAULT_WEIGHT_KG } from '../utils/weight';

const PERSONAL_MODEL_KEY = 'hrt-personal-model';
const APPLY_E2_LEARNING_TO_CPA_KEY = 'hrt-apply-e2-learning-to-cpa';
const CALIBRATION_MODEL_KEY = 'hrt-calibration-model';
const CALIBRATION_MODE_KEY = 'hrt-calibration-mode';
const APPLY_CPA_INHIBITION_TO_E2_KEY = 'hrt-apply-cpa-inhibition-to-e2';
const THEME_COLOR_KEY = 'hrt-theme-color';
const DARK_MODE_KEY = 'hrt-dark-mode';
const THEME_MODE_KEY = 'hrt-theme-mode';
const WEIGHT_MIGRATION_FLAG = 'hrt-weight-per-dose-migrated';
const LEGACY_WEIGHT_KEY = 'hrt-weight';

export const PER_DOSE_WEIGHT_MIGRATION_EVENT = 'hrt-per-dose-weight-migrated';

interface CompoundCI {
    adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
}

interface SimCI {
    timeH: number[];
    e2Adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
    ci68Low: number[];
    ci68High: number[];
    antiandrogen: Partial<Record<string, CompoundCI>>;
}

interface AppDataContextType {
    events: DoseEvent[];
    setEvents: React.Dispatch<React.SetStateAction<DoseEvent[]>>;
    labResults: LabResult[];
    setLabResults: React.Dispatch<React.SetStateAction<LabResult[]>>;
    simulation: SimulationResult | null;
    calibrationFn: (h: number) => number;
    currentTime: Date;
    personalModel: PersonalModelState | null;
    simCI: SimCI | null;
    lastDiagnostics: EKFDiagnostics | null;
    applyE2LearningToCPA: boolean;
    setApplyE2LearningToCPA: React.Dispatch<React.SetStateAction<boolean>>;
    applyCPAInhibitionToE2: boolean;
    setApplyCPAInhibitionToE2: React.Dispatch<React.SetStateAction<boolean>>;
    calibrationModel: CalibrationModel;
    setCalibrationModel: React.Dispatch<React.SetStateAction<CalibrationModel>>;
    /**
     * Temporal semantics of the personalised curve. `retrospective` (default)
     * re-fits the whole curve from all labs (EKF final state / OU RTS smoother),
     * so new labs reshape history — the desired behaviour. `causal` estimates
     * each point from only the labs available up to that time (forward-only).
     * Dose-causality (a logged dose not shifting earlier estimates) holds in BOTH
     * modes — it comes from the exact per-point curve, not from this flag.
     */
    calibrationMode: CalibrationMode;
    setCalibrationMode: React.Dispatch<React.SetStateAction<CalibrationMode>>;
    /** User-created custom transdermal-gel products (cloud-synced). Presets live in code. */
    gelProducts: GelProductSpec[];
    setGelProducts: React.Dispatch<React.SetStateAction<GelProductSpec[]>>;
    resetPersonalModel: () => void;
    /**
     * Endogenous baseline E2 in pg/mL derived from pre-dose lab results.
     * Non-null when the personal model has accumulated at least one pre-dose
     * observation. Used to offset the simulated curve even before any post-dose
     * data is available.
     */
    baselineE2PGmL: number | null;
}

const AppDataContext = createContext<AppDataContextType | undefined>(undefined);

function loadPersonalModel(): PersonalModelState | null {
    try {
        const raw = localStorage.getItem(PERSONAL_MODEL_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        // Validate shape AND value ranges before trusting stored data.
        // Theta values outside ±4 (log-space) indicate a corrupted/stale model;
        // reject and let the replay effect recompute from lab results.
        if (
            parsed?.modelVersion === 'pk-ekf-v1' &&
            Array.isArray(parsed.thetaMean) && parsed.thetaMean.length === 2 &&
            typeof parsed.thetaMean[0] === 'number' && Math.abs(parsed.thetaMean[0]) <= 4 &&
            typeof parsed.thetaMean[1] === 'number' && Math.abs(parsed.thetaMean[1]) <= 4 &&
            Array.isArray(parsed.thetaCov) && parsed.thetaCov.length === 2 &&
            typeof parsed.Rlog === 'number' &&
            typeof parsed.observationCount === 'number' &&
            Array.isArray(parsed.anchors)
        ) {
            // Backward-compat: old stored models lack postDoseObservationCount.
            // Fall back to observationCount so existing calibrated models keep
            // their CI bands rather than silently resetting to uncalibrated state.
            if (typeof parsed.postDoseObservationCount !== 'number') {
                parsed.postDoseObservationCount = parsed.observationCount;
            }
            return parsed as PersonalModelState;
        }
    } catch { /* ignore */ }
    return null;
}

function savePersonalModel(state: PersonalModelState | null) {
    if (state) {
        localStorage.setItem(PERSONAL_MODEL_KEY, JSON.stringify(state));
    } else {
        localStorage.removeItem(PERSONAL_MODEL_KEY);
    }
}

export const AppDataProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // Set inside the useState initializer below when initial-load migration
    // backfills weights for the first time. A useEffect later dispatches the
    // user-facing toast — using a ref + effect (rather than setTimeout(0))
    // guarantees the dispatch happens AFTER MainLayout's listener registers,
    // so the toast cannot be lost to a race.
    const justMigratedRef = useRef(false);

    const [events, setEvents] = useState<DoseEvent[]>(() => {
        const saved = localStorage.getItem('hrt-events');
        const parsed: DoseEvent[] = saved ? JSON.parse(saved) : [];
        // One-shot per-dose-weight migration: backfill events that predate the
        // schema change so every PK call has a real weight to work with.
        if (eventsNeedWeightMigration(parsed)) {
            const legacyRaw = localStorage.getItem(LEGACY_WEIGHT_KEY);
            const legacyW = legacyRaw ? parseFloat(legacyRaw) : DEFAULT_WEIGHT_KG;
            const migrated = backfillEventWeights(parsed, legacyW);
            localStorage.setItem('hrt-events', JSON.stringify(migrated));
            if (!localStorage.getItem(WEIGHT_MIGRATION_FLAG)) {
                localStorage.setItem(WEIGHT_MIGRATION_FLAG, '1');
                justMigratedRef.current = true;
            }
            return migrated;
        }
        return parsed;
    });

    // Fire the migration toast once after mount when initial-load migration
    // happened this session. Effect runs after children mount, so MainLayout's
    // listener is already attached.
    useEffect(() => {
        if (justMigratedRef.current) {
            justMigratedRef.current = false;
            window.dispatchEvent(new CustomEvent(PER_DOSE_WEIGHT_MIGRATION_EVENT));
        }
    }, []);

    const [labResults, setLabResults] = useState<LabResult[]>(() => {
        const saved = localStorage.getItem('hrt-lab-results');
        return saved ? JSON.parse(saved) : [];
    });

    const [simulation, setSimulation] = useState<SimulationResult | null>(null);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [personalModel, setPersonalModel] = useState<PersonalModelState | null>(loadPersonalModel);
    const [simCI, setSimCI] = useState<SimCI | null>(null);
    const [lastDiagnostics, setLastDiagnostics] = useState<EKFDiagnostics | null>(null);
    const [applyE2LearningToCPA, setApplyE2LearningToCPA] = useState<boolean>(() => {
        const raw = localStorage.getItem(APPLY_E2_LEARNING_TO_CPA_KEY);
        if (raw === null) return false;
        return raw === '1' || raw.toLowerCase() === 'true';
    });
    const [calibrationModel, setCalibrationModel] = useState<CalibrationModel>(() => {
        const raw = localStorage.getItem(CALIBRATION_MODEL_KEY);
        return (raw === 'ou-kalman' || raw === 'hybrid-mipd') ? raw : 'ekf';
    });
    const [calibrationMode, setCalibrationMode] = useState<CalibrationMode>(() => {
        const raw = localStorage.getItem(CALIBRATION_MODE_KEY);
        // Default to 'retrospective': new lab results SHOULD recalibrate the whole
        // history (that is correct and desired). Dose-causality — a newly logged
        // dose not shifting earlier estimates — is guaranteed separately by the
        // exact per-point personalised curve, independent of this mode. Only opt
        // into the forward-only 'causal' view when explicitly selected.
        return (raw === 'causal') ? 'causal' : 'retrospective';
    });
    const [applyCPAInhibitionToE2, setApplyCPAInhibitionToE2] = useState<boolean>(() => {
        const raw = localStorage.getItem(APPLY_CPA_INHIBITION_TO_E2_KEY);
        if (raw === null) return false;
        return raw === '1' || raw.toLowerCase() === 'true';
    });
    const [gelProducts, setGelProducts] = useState<GelProductSpec[]>(() => readCustomGelProducts());

    const suppressLocalUpdateRef = useRef({
        events: false,
        labResults: false,
        calibrationModel: false,
        calibrationMode: false,
        applyE2LearningToCPA: false,
        applyCPAInhibitionToE2: false,
        gelProducts: false,
    });
    const isInitialLoadRef = useRef({
        events: true,
        labResults: true,
        calibrationModel: true,
        calibrationMode: true,
        applyE2LearningToCPA: true,
        applyCPAInhibitionToE2: true,
        gelProducts: true,
    });

    const markExternalUpdate = (key: keyof typeof suppressLocalUpdateRef.current) => {
        suppressLocalUpdateRef.current[key] = true;
    };

    const finalizeLocalUpdate = (key: keyof typeof suppressLocalUpdateRef.current, updateKey: string) => {
        if (suppressLocalUpdateRef.current[key]) {
            suppressLocalUpdateRef.current[key] = false;
            return;
        }
        if (isInitialLoadRef.current[key]) {
            isInitialLoadRef.current[key] = false;
            return;
        }
        const lastModified = new Date().toISOString();
        localStorage.setItem('hrt-last-modified', lastModified);
        localStorage.setItem('hrt-last-data-updated', lastModified);
        window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: updateKey, lastModified } }));
    };

    // Persist to localStorage
    useEffect(() => {
        const value = JSON.stringify(events);
        localStorage.setItem('hrt-events', value);
        // Legacy compat: keep top-level weight in sync with most recent event
        // so older clients / cloud snapshots still see a meaningful value.
        // Guard on events.length > 0 so a user who set a global weight before
        // recording any doses doesn't lose it the first time this effect runs.
        if (events.length > 0) {
            localStorage.setItem(LEGACY_WEIGHT_KEY, latestEventWeight(events).toString());
        }
        finalizeLocalUpdate('events', 'hrt-events');
    }, [events]);
    useEffect(() => {
        const value = JSON.stringify(labResults);
        localStorage.setItem('hrt-lab-results', value);
        finalizeLocalUpdate('labResults', 'hrt-lab-results');
    }, [labResults]);
    useEffect(() => {
        localStorage.setItem(APPLY_E2_LEARNING_TO_CPA_KEY, applyE2LearningToCPA ? '1' : '0');
        finalizeLocalUpdate('applyE2LearningToCPA', APPLY_E2_LEARNING_TO_CPA_KEY);
    }, [applyE2LearningToCPA]);
    useEffect(() => {
        localStorage.setItem(APPLY_CPA_INHIBITION_TO_E2_KEY, applyCPAInhibitionToE2 ? '1' : '0');
        finalizeLocalUpdate('applyCPAInhibitionToE2', APPLY_CPA_INHIBITION_TO_E2_KEY);
    }, [applyCPAInhibitionToE2]);
    useEffect(() => {
        localStorage.setItem(CALIBRATION_MODEL_KEY, calibrationModel);
        finalizeLocalUpdate('calibrationModel', CALIBRATION_MODEL_KEY);
    }, [calibrationModel]);
    useEffect(() => {
        localStorage.setItem(CALIBRATION_MODE_KEY, calibrationMode);
        finalizeLocalUpdate('calibrationMode', CALIBRATION_MODE_KEY);
    }, [calibrationMode]);
    useEffect(() => {
        writeCustomGelProducts(gelProducts);
        finalizeLocalUpdate('gelProducts', GEL_PRODUCTS_KEY);
    }, [gelProducts]);

    useEffect(() => {
        const lang = localStorage.getItem('hrt-lang') || 'en';
        const themeColor = localStorage.getItem('hrt-theme-color') || 'sakura';
        const darkModeRaw = localStorage.getItem('hrt-dark-mode');
        const darkMode = darkModeRaw === '1' || darkModeRaw === 'true';
        const themeMode = localStorage.getItem(THEME_MODE_KEY) || (darkMode ? 'dark' : 'light');
        const gelProductsRaw = localStorage.getItem(GEL_PRODUCTS_KEY);
        const gelProductsParsed = gelProductsRaw ? JSON.parse(gelProductsRaw) : [];
        const hash = computeDataHash({ events, weight: latestEventWeight(events), labResults, lang, calibrationModel, calibrationMode, applyE2LearningToCPA, applyCPAInhibitionToE2, themeColor, themeMode, darkMode, gelProducts: gelProductsParsed });
        localStorage.setItem('hrt-data-hash', hash);
    }, [events, labResults, calibrationModel, calibrationMode, applyE2LearningToCPA, applyCPAInhibitionToE2, gelProducts]);

    // Update current time every minute
    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 60000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            const syncKeys = ['hrt-events', 'hrt-lab-results', 'hrt-calibration-model', CALIBRATION_MODE_KEY, APPLY_E2_LEARNING_TO_CPA_KEY, APPLY_CPA_INHIBITION_TO_E2_KEY, THEME_COLOR_KEY, THEME_MODE_KEY, DARK_MODE_KEY, GEL_PRODUCTS_KEY];
            const isCloudSync = e.key === 'hrt-data-synced';
            const isOtherTabSync = e.storageArea === localStorage && e.key && syncKeys.includes(e.key);
            if (!isCloudSync && !isOtherTabSync) {
                return;
            }

            if (e.key === 'hrt-events' || isCloudSync) {
                if (isCloudSync || isOtherTabSync) {
                    markExternalUpdate('events');
                }
                const saved = localStorage.getItem('hrt-events');
                const parsed: DoseEvent[] = saved ? JSON.parse(saved) : [];
                if (eventsNeedWeightMigration(parsed)) {
                    const legacyRaw = localStorage.getItem(LEGACY_WEIGHT_KEY);
                    const legacyW = legacyRaw ? parseFloat(legacyRaw) : DEFAULT_WEIGHT_KG;
                    const migrated = backfillEventWeights(parsed, legacyW);
                    // First time we see legacy events (cloud sync / cross-tab):
                    // set the flag and announce the migration so the user knows
                    // why their data was rewritten. The listener (MainLayout)
                    // is always mounted by the time storage events fire.
                    if (!localStorage.getItem(WEIGHT_MIGRATION_FLAG)) {
                        localStorage.setItem(WEIGHT_MIGRATION_FLAG, '1');
                        window.dispatchEvent(new CustomEvent(PER_DOSE_WEIGHT_MIGRATION_EVENT));
                    }
                    setEvents(migrated);
                } else {
                    setEvents(parsed);
                }
            }

            if (e.key === 'hrt-lab-results' || isCloudSync) {
                if (isCloudSync || isOtherTabSync) {
                    markExternalUpdate('labResults');
                }
                const saved = localStorage.getItem('hrt-lab-results');
                setLabResults(saved ? JSON.parse(saved) : []);
            }

            if (e.key === 'hrt-calibration-model' && isOtherTabSync) {
                markExternalUpdate('calibrationModel');
                const saved = localStorage.getItem(CALIBRATION_MODEL_KEY);
                if (saved === 'ou-kalman' || saved === 'ekf' || saved === 'hybrid-mipd') {
                    setCalibrationModel(saved);
                }
            }

            if (e.key === CALIBRATION_MODE_KEY && isOtherTabSync) {
                markExternalUpdate('calibrationMode');
                const saved = localStorage.getItem(CALIBRATION_MODE_KEY);
                if (saved === 'causal' || saved === 'retrospective') {
                    setCalibrationMode(saved);
                }
            }

            if (e.key === APPLY_E2_LEARNING_TO_CPA_KEY && isOtherTabSync) {
                markExternalUpdate('applyE2LearningToCPA');
                const saved = localStorage.getItem(APPLY_E2_LEARNING_TO_CPA_KEY);
                if (saved !== null) setApplyE2LearningToCPA(saved === '1' || saved.toLowerCase() === 'true');
            }

            if (e.key === APPLY_CPA_INHIBITION_TO_E2_KEY && isOtherTabSync) {
                markExternalUpdate('applyCPAInhibitionToE2');
                const saved = localStorage.getItem(APPLY_CPA_INHIBITION_TO_E2_KEY);
                if (saved !== null) setApplyCPAInhibitionToE2(saved === '1' || saved.toLowerCase() === 'true');
            }

            if (e.key === GEL_PRODUCTS_KEY && isOtherTabSync) {
                markExternalUpdate('gelProducts');
                setGelProducts(readCustomGelProducts());
            }

            if (isCloudSync) {
                markExternalUpdate('gelProducts');
                setGelProducts(readCustomGelProducts());
                markExternalUpdate('calibrationModel');
                const saved = localStorage.getItem(CALIBRATION_MODEL_KEY);
                if (saved === 'ou-kalman' || saved === 'ekf' || saved === 'hybrid-mipd') {
                    setCalibrationModel(saved);
                }
                markExternalUpdate('calibrationMode');
                const savedMode = localStorage.getItem(CALIBRATION_MODE_KEY);
                if (savedMode === 'causal' || savedMode === 'retrospective') {
                    setCalibrationMode(savedMode);
                }
                markExternalUpdate('applyE2LearningToCPA');
                const savedE2 = localStorage.getItem(APPLY_E2_LEARNING_TO_CPA_KEY);
                if (savedE2 !== null) setApplyE2LearningToCPA(savedE2 === '1' || savedE2.toLowerCase() === 'true');
                markExternalUpdate('applyCPAInhibitionToE2');
                const savedCPA = localStorage.getItem(APPLY_CPA_INHIBITION_TO_E2_KEY);
                if (savedCPA !== null) setApplyCPAInhibitionToE2(savedCPA === '1' || savedCPA.toLowerCase() === 'true');

                // Notify ThemeContext about cloud-synced theme/dark mode changes
                const savedTheme = localStorage.getItem(THEME_COLOR_KEY);
                if (savedTheme) {
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: THEME_COLOR_KEY,
                        newValue: savedTheme,
                        storageArea: localStorage,
                    }));
                }
                const savedDark = localStorage.getItem(DARK_MODE_KEY);
                if (savedDark !== null) {
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: DARK_MODE_KEY,
                        newValue: savedDark,
                        storageArea: localStorage,
                    }));
                }
                const savedThemeMode = localStorage.getItem(THEME_MODE_KEY);
                if (savedThemeMode) {
                    window.dispatchEvent(new StorageEvent('storage', {
                        key: THEME_MODE_KEY,
                        newValue: savedThemeMode,
                        storageArea: localStorage,
                    }));
                }
            }
        };

        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    // Keep the PK engine's custom-gel registry in sync so gel events (which only
    // store a product id) resolve their kinetics correctly. Done before any
    // simulation so editing a custom product re-resolves all of its records.
    useEffect(() => {
        setCustomGelProducts(gelProducts);
    }, [gelProducts]);

    // Run simulation when events (or the custom-gel registry) change. Per-event
    // weight is read from events; gel kinetics are resolved from the registry.
    useEffect(() => {
        setCustomGelProducts(gelProducts);
        if (events.length > 0) {
            const res = runSimulation(events);
            setSimulation(res);
        } else {
            setSimulation(null);
        }
    }, [events, gelProducts]);

    // Rebuild personal model whenever events, labResults, or the custom-gel
    // registry change (gel calibration resolves kinetics from the registry).
    useEffect(() => {
        setCustomGelProducts(gelProducts);
        if (labResults.length === 0) {
            setPersonalModel(null);
            setLastDiagnostics(null);
            setSimCI(null);
            savePersonalModel(null);
            return;
        }

        // Replay EKF from the prior using all sorted lab results
        const newModel = replayPersonalModel(events, labResults);

        // Derive last diagnostics from the most recent lab point
        const sorted = [...labResults].sort((a, b) => a.timeH - b.timeH);
        const lastLab = sorted[sorted.length - 1];

        // Build prior state (n-1 replayed) to get the update diagnostics
        const priorModel = labResults.length > 1
            ? replayPersonalModel(events, sorted.slice(0, -1))
            : initPersonalModel();

        const { diagnostics } = ekfUpdatePersonalModel(
            events, priorModel, lastLab,
            labResults.length > 1 ? sorted[sorted.length - 2].timeH : undefined
        );
        setLastDiagnostics(diagnostics);

        setPersonalModel(newModel);
        savePersonalModel(newModel);
    }, [events, labResults, gelProducts]);

    // Recompute CI bands whenever relevant state changes.
    // - E2 personal CI (e2Adjusted + ci bands) requires at least one post-dose
    //   lab result; pre-dose labs only provide a baseline offset.
    // - Anti-androgen population CI (CPA / BICA) does NOT need any E2 lab: it is
    //   a population-PK uncertainty band. So when anti-androgen doses exist but
    //   no E2 personal model is available yet, we still emit a simCI whose E2
    //   personal arrays are empty (keeping the E2 "personal model" UI hidden)
    //   while the antiandrogen map carries the population band.
    useEffect(() => {
        if (!simulation) {
            setSimCI(null);
            return;
        }
        const hasE2Personal = !!personalModel && personalModel.postDoseObservationCount > 0 && labResults.length > 0;
        const hasAntiandrogen = events.some(e => isAntiandrogen(e.ester));

        if (hasE2Personal) {
            const ci = computeSimulationWithCI(simulation, events, personalModel!, applyE2LearningToCPA, labResults, calibrationModel, applyCPAInhibitionToE2, calibrationMode);
            setSimCI(ci);
        } else if (hasAntiandrogen) {
            // Population-only path: no learned theta, no adherence coupling. Mode is
            // irrelevant with no labs, but pass it through for consistency.
            const ci = computeSimulationWithCI(simulation, events, initPersonalModel(), false, [], 'ekf', false, calibrationMode);
            setSimCI({ ...ci, e2Adjusted: [], ci95Low: [], ci95High: [], ci68Low: [], ci68High: [] });
        } else {
            setSimCI(null);
        }
    }, [simulation, personalModel, events, applyE2LearningToCPA, labResults, calibrationModel, applyCPAInhibitionToE2, calibrationMode]);

    // Expose baseline from pre-dose labs so UI can offset the raw sim curve
    // even when no post-dose learning has occurred yet.
    const baselineE2PGmL = useMemo<number | null>(() => {
        if (!personalModel) return null;
        const v = personalModel.baselinePGmL;
        if (v === undefined || !Number.isFinite(v) || v <= 0) return null;
        return v;
    }, [personalModel]);

    // Create calibration function (legacy ratio-based, still used for current-scale display)
    const calibrationFn = useMemo(() => {
        return createCalibrationInterpolator(simulation, labResults);
    }, [simulation, labResults]);

    const resetPersonalModel = useCallback(() => {
        setPersonalModel(null);
        setLastDiagnostics(null);
        setSimCI(null);
        savePersonalModel(null);
    }, []);

    const value = {
        events,
        setEvents,
        labResults,
        setLabResults,
        simulation,
        calibrationFn,
        currentTime,
        personalModel,
        simCI,
        lastDiagnostics,
        applyE2LearningToCPA,
        setApplyE2LearningToCPA,
        applyCPAInhibitionToE2,
        setApplyCPAInhibitionToE2,
        calibrationModel,
        setCalibrationModel,
        calibrationMode,
        setCalibrationMode,
        gelProducts,
        setGelProducts,
        resetPersonalModel,
        baselineE2PGmL,
    };

    return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
};

export const useAppData = () => {
    const context = useContext(AppDataContext);
    if (context === undefined) {
        throw new Error('useAppData must be used within an AppDataProvider');
    }
    return context;
};
