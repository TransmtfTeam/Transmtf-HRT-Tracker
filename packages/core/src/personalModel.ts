import { Route, Ester, type DoseEvent, type LabResult, type SimulationResult } from './types.js';
import {
    CorePK,
    CPA_2COMP_PK,
    resolveParams,
    compute2CompCPACentralAmount,
    _analytic3C,
    oneCompAmount,
} from './pk.js';
import {
    convertToPgMl,
    buildOUKalmanCalibration,
    type CalibrationModel,
} from './calibration.js';

export interface ResidualAnchor {
    timeH: number;
    logRatio: number;
    w: number;
    kind: 'lab';
}

export interface PersonalModelState {
    modelVersion: 'pk-ekf-v1';
    thetaMean: [number, number];
    thetaCov: [[number, number], [number, number]];
    Q: [[number, number], [number, number]];
    Rlog: number;
    anchors: ResidualAnchor[];
    observationCount: number;
    updatedAt: string;
}

export interface EKFDiagnostics {
    NIS: number;
    isOutlier: boolean;
    residualLog: number;
    predictedPGmL: number;
    observedPGmL: number;
    ci95Low: number;
    ci95High: number;
    convergenceScore: number;
    thetaS: number;
    thetaK: number;
}

const EKF_INITIAL_COV: [[number, number], [number, number]] = [[0.25, 0.0], [0.0, 0.09]];
const EKF_Q: [[number, number], [number, number]] = [[0.0004, 0.0], [0.0, 0.0001]];
const EKF_RLOG = 0.04;
const EKF_EPS = 0.1;
const EKF_EPS_CPA = 0.001;
const EKF_CHI2_95 = 3.841;
const EKF_DELTA_K = 0.01;
const EKF_CI_MAX_E2 = 5000;
const EKF_CI_MAX_CPA = 500;
const EKF_SIGMA_RESIDUAL_LOG = 0.27;
const EKF_Q_REF_PERIOD_H = 30 * 24;

const CPA_E2_INHIBITION = {
    Emax: 0.20,
    IC50: 50.0,
    n: 1.0,
};

/** Initialise a new personal model state at the population prior. */
export function initPersonalModel(): PersonalModelState {
    return {
        modelVersion: 'pk-ekf-v1',
        thetaMean: [0, 0],
        thetaCov: EKF_INITIAL_COV,
        Q: EKF_Q,
        Rlog: EKF_RLOG,
        anchors: [],
        observationCount: 0,
        updatedAt: new Date().toISOString(),
    };
}

/**
 * Compute the E2-family amount contributed by a single event with a scaled
 * clearance rate. CPA is excluded here because its PK is modeled separately.
 */
function computeEventAmountWithKScale(
    event: DoseEvent,
    allEvents: DoseEvent[],
    tau: number,
    kScale: number
): number {
    if (tau < 0) return 0;
    if (event.route === Route.patchRemove) return 0;
    if (event.ester === Ester.CPA) return 0;

    const params = resolveParams(event);
    const k3 = params.k3 * kScale;

    switch (event.route) {
        case Route.injection: {
            const doseFast = event.doseMG * params.Frac_fast;
            const doseSlow = event.doseMG * (1.0 - params.Frac_fast);
            return _analytic3C(tau, doseFast, params.F, params.k1_fast, params.k2, k3) +
                   _analytic3C(tau, doseSlow, params.F, params.k1_slow, params.k2, k3);
        }
        case Route.gel:
        case Route.oral: {
            const paramsK = { ...params, k3 };
            return oneCompAmount(tau, event.doseMG, paramsK);
        }
        case Route.sublingual: {
            const doseFast = event.doseMG * params.Frac_fast;
            const doseSlow = event.doseMG * (1.0 - params.Frac_fast);
            if (params.k2 > 0) {
                return _analytic3C(tau, doseFast, params.F_fast, params.k1_fast, params.k2, k3) +
                       _analytic3C(tau, doseSlow, params.F_slow, params.k1_slow, params.k2, k3);
            }

            const branch = (dose: number, bioavailability: number, ka: number, ke: number, t: number): number => {
                if (Math.abs(ka - ke) < 1e-9) return dose * bioavailability * ka * t * Math.exp(-ke * t);
                return dose * bioavailability * ka / (ka - ke) * (Math.exp(-ke * t) - Math.exp(-ka * t));
            };
            return branch(doseFast, params.F_fast, params.k1_fast, k3, tau) +
                   branch(doseSlow, params.F_slow, params.k1_slow, k3, tau);
        }
        case Route.patchApply: {
            const remove = allEvents.find((e) => e.route === Route.patchRemove && e.timeH > event.timeH);
            const wearH = (remove?.timeH ?? Number.MAX_VALUE) - event.timeH;
            if (params.rateMGh > 0) {
                if (tau <= wearH) {
                    return params.rateMGh / k3 * (1 - Math.exp(-k3 * tau));
                }
                const amtAtRemoval = params.rateMGh / k3 * (1 - Math.exp(-k3 * wearH));
                return amtAtRemoval * Math.exp(-k3 * (tau - wearH));
            }

            const paramsK = { ...params, k3 };
            const amtUnder = oneCompAmount(tau, event.doseMG, paramsK);
            if (tau > wearH) {
                const amtAtRemoval = oneCompAmount(wearH, event.doseMG, paramsK);
                return amtAtRemoval * Math.exp(-k3 * (tau - wearH));
            }
            return amtUnder;
        }
        default:
            return 0;
    }
}

function computeCPAAmountWithAdherence(
    event: DoseEvent,
    tau: number,
    adherenceScale: number
): number {
    if (tau < 0 || event.ester !== Ester.CPA) return 0;
    return compute2CompCPACentralAmount(event.doseMG * adherenceScale, tau);
}

/**
 * Compute CPA plasma concentration in ng/mL at a single time point using the
 * E2-inferred adherence scale and the fixed CPA population PK model.
 */
export function computeCPAAtTimeWithTheta(
    events: DoseEvent[],
    weight: number,
    timeH: number,
    theta: [number, number]
): number {
    const adherence = Math.exp(theta[0]);
    const sorted = [...events].sort((a, b) => a.timeH - b.timeH);
    let totalCentralMG = 0;
    for (const event of sorted) {
        if (event.timeH > timeH) continue;
        totalCentralMG += computeCPAAmountWithAdherence(event, timeH - event.timeH, adherence);
    }
    const v1mL = CPA_2COMP_PK.V1_per_kg * weight * 1000;
    return Math.max(0, (totalCentralMG * 1e6) / v1mL);
}

/**
 * Compute E2 plasma concentration in pg/mL at a single time point using the
 * personalized scaling parameters theta = [theta_s, theta_k].
 */
export function computeE2AtTimeWithTheta(
    events: DoseEvent[],
    weight: number,
    timeH: number,
    theta: [number, number]
): number {
    const s = Math.exp(theta[0]);
    const kScale = Math.exp(theta[1]);
    const sorted = [...events].sort((a, b) => a.timeH - b.timeH);

    let totalMG = 0;
    for (const event of sorted) {
        if (event.timeH > timeH) continue;
        totalMG += computeEventAmountWithKScale(event, sorted, timeH - event.timeH, kScale);
    }

    const plasmaVolML = CorePK.vdPerKG * weight * 1000;
    return Math.max(0, (totalMG * 1e9) / plasmaVolML * s);
}

/**
 * EKF update: incorporate one new lab result into the personal model and
 * return both the updated state and diagnostics for that observation.
 */
export function ekfUpdatePersonalModel(
    events: DoseEvent[],
    weight: number,
    state: PersonalModelState,
    labResult: LabResult,
    prevLabTimeH?: number
): { newState: PersonalModelState; diagnostics: EKFDiagnostics } {
    const hasDoseBeforeLab = events.some((ev) =>
        ev.timeH <= labResult.timeH &&
        ev.route !== Route.patchRemove &&
        ev.ester !== Ester.CPA
    );

    const obsPGmL = convertToPgMl(labResult.concValue, labResult.unit);
    const y = Math.log(Math.max(obsPGmL, EKF_EPS));

    const theta = state.thetaMean.slice() as [number, number];
    const dtH = prevLabTimeH !== undefined
        ? Math.max(24, labResult.timeH - prevLabTimeH)
        : EKF_Q_REF_PERIOD_H;
    const qScale = dtH / EKF_Q_REF_PERIOD_H;
    const P: [[number, number], [number, number]] = [
        [state.thetaCov[0][0] + state.Q[0][0] * qScale, state.thetaCov[0][1] + state.Q[0][1] * qScale],
        [state.thetaCov[1][0] + state.Q[1][0] * qScale, state.thetaCov[1][1] + state.Q[1][1] * qScale],
    ];

    const predPGmL = computeE2AtTimeWithTheta(events, weight, labResult.timeH, theta);
    const yhat = Math.log(Math.max(predPGmL, EKF_EPS));

    if (!hasDoseBeforeLab) {
        const initialTrace = EKF_INITIAL_COV[0][0] + EKF_INITIAL_COV[1][1];
        const currentTrace = state.thetaCov[0][0] + state.thetaCov[1][1];
        const convergenceScore = Math.max(0, Math.min(1, 1 - currentTrace / initialTrace));

        const baselineState: PersonalModelState = {
            ...state,
            updatedAt: new Date().toISOString(),
        };
        const diagnostics: EKFDiagnostics = {
            NIS: 0,
            isOutlier: false,
            residualLog: 0,
            predictedPGmL: predPGmL,
            observedPGmL: obsPGmL,
            ci95Low: obsPGmL,
            ci95High: obsPGmL,
            convergenceScore,
            thetaS: Math.exp(state.thetaMean[0]),
            thetaK: Math.exp(state.thetaMean[1]),
        };
        return { newState: baselineState, diagnostics };
    }

    const thetaKPerturbed: [number, number] = [theta[0], theta[1] + EKF_DELTA_K];
    const predPerturbed = computeE2AtTimeWithTheta(events, weight, labResult.timeH, thetaKPerturbed);
    const yhatPerturbed = Math.log(Math.max(predPerturbed, EKF_EPS));
    const H: [number, number] = [1.0, (yhatPerturbed - yhat) / EKF_DELTA_K];

    const innovation = y - yhat;
    const S = H[0] * H[0] * P[0][0] + 2 * H[0] * H[1] * P[0][1] + H[1] * H[1] * P[1][1] + state.Rlog;
    const NIS = S > 0 ? (innovation * innovation) / S : 0;
    const isOutlier = NIS > EKF_CHI2_95;

    const Reff = isOutlier ? state.Rlog * 4.0 : state.Rlog;
    const Seff = H[0] * H[0] * P[0][0] + 2 * H[0] * H[1] * P[0][1] + H[1] * H[1] * P[1][1] + Reff;

    const K: [number, number] = [
        (P[0][0] * H[0] + P[0][1] * H[1]) / Seff,
        (P[1][0] * H[0] + P[1][1] * H[1]) / Seff,
    ];

    const thetaNew: [number, number] = [theta[0] + K[0] * innovation, theta[1] + K[1] * innovation];

    const i00 = 1 - K[0] * H[0];
    const i01 = -K[0] * H[1];
    const i10 = -K[1] * H[0];
    const i11 = 1 - K[1] * H[1];
    const PNew: [[number, number], [number, number]] = [
        [i00 * P[0][0] + i01 * P[1][0], i00 * P[0][1] + i01 * P[1][1]],
        [i10 * P[0][0] + i11 * P[1][0], i10 * P[0][1] + i11 * P[1][1]],
    ];
    PNew[0][1] = PNew[1][0] = (PNew[0][1] + PNew[1][0]) / 2;
    PNew[0][0] = Math.max(PNew[0][0], 1e-6);
    PNew[1][1] = Math.max(PNew[1][1], 1e-6);

    const newPredPGmL = computeE2AtTimeWithTheta(events, weight, labResult.timeH, thetaNew);
    const logRatioPost = Math.log(Math.max(obsPGmL, EKF_EPS)) - Math.log(Math.max(newPredPGmL, EKF_EPS));
    const anchor: ResidualAnchor = {
        timeH: labResult.timeH,
        logRatio: logRatioPost,
        w: isOutlier ? 0.3 : 1.0,
        kind: 'lab',
    };
    const updatedAnchors = [...state.anchors, anchor]
        .sort((a, b) => a.timeH - b.timeH)
        .slice(-20);

    const hK = H[1];
    const varYhat = PNew[0][0] + 2 * PNew[0][1] * hK + PNew[1][1] * hK * hK;
    const std95 = Math.sqrt(Math.max(0, varYhat + Reff));
    const logPredNew = Math.log(Math.max(newPredPGmL, EKF_EPS));
    const ci95Low = Math.exp(logPredNew - 1.96 * std95);
    const ci95High = Math.exp(logPredNew + 1.96 * std95);

    const initialTrace = EKF_INITIAL_COV[0][0] + EKF_INITIAL_COV[1][1];
    const currentTrace = PNew[0][0] + PNew[1][1];
    const convergenceScore = Math.max(0, Math.min(1, 1 - currentTrace / initialTrace));

    const newState: PersonalModelState = {
        modelVersion: 'pk-ekf-v1',
        thetaMean: thetaNew,
        thetaCov: PNew,
        Q: state.Q,
        Rlog: state.Rlog,
        anchors: updatedAnchors,
        observationCount: state.observationCount + 1,
        updatedAt: new Date().toISOString(),
    };

    const diagnostics: EKFDiagnostics = {
        NIS,
        isOutlier,
        residualLog: innovation,
        predictedPGmL: predPGmL,
        observedPGmL: obsPGmL,
        ci95Low,
        ci95High,
        convergenceScore,
        thetaS: Math.exp(thetaNew[0]),
        thetaK: Math.exp(thetaNew[1]),
    };

    return { newState, diagnostics };
}

/**
 * Replay all lab results from the population prior to rebuild the personal
 * model after events or labs are edited.
 */
export function replayPersonalModel(
    events: DoseEvent[],
    weight: number,
    labResults: LabResult[]
): PersonalModelState {
    let state = initPersonalModel();
    const sorted = [...labResults].sort((a, b) => a.timeH - b.timeH);
    for (let i = 0; i < sorted.length; i++) {
        const prevTimeH = i > 0 ? sorted[i - 1].timeH : undefined;
        const { newState } = ekfUpdatePersonalModel(events, weight, state, sorted[i], prevTimeH);
        state = newState;
    }
    return state;
}

/**
 * Compute the fraction of E2 clearance inhibited by CPA at a given
 * concentration using a Hill-style saturation model.
 */
export function computeCPAE2InhibitionFactor(
    cpaNgML: number,
    params = CPA_E2_INHIBITION
): number {
    if (!Number.isFinite(cpaNgML) || cpaNgML <= 0) return 0;
    const { Emax, IC50, n } = params;
    if (!Number.isFinite(Emax) || Emax <= 0 || !Number.isFinite(IC50) || IC50 <= 0 || !Number.isFinite(n) || n <= 0) return 0;
    const Dn = Math.pow(cpaNgML, n);
    const IC50n = Math.pow(IC50, n);
    return Math.min(Math.max(0, Emax * Dn / (IC50n + Dn)), Emax * 0.9999);
}

/**
 * Compute a full simulation curve with calibration-aware E2 and adherence-aware
 * CPA estimates plus confidence intervals.
 */
export function computeSimulationWithCI(
    sim: SimulationResult,
    events: DoseEvent[],
    weight: number,
    state: PersonalModelState,
    applyE2LearningToCPA: boolean = true,
    labResults: LabResult[] = [],
    calibrationModel: CalibrationModel = 'ekf',
    applyCPAInhibitionToE2: boolean = false
): {
    timeH: number[];
    e2Adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
    ci68Low: number[];
    ci68High: number[];
    cpaAdjusted: number[];
    cpaCi95Low: number[];
    cpaCi95High: number[];
} {
    const n = sim.timeH.length;
    if (n === 0) {
        return {
            timeH: [],
            e2Adjusted: [],
            ci95Low: [],
            ci95High: [],
            ci68Low: [],
            ci68High: [],
            cpaAdjusted: [],
            cpaCi95Low: [],
            cpaCi95High: [],
        };
    }

    const theta = state.thetaMean;
    const P = state.thetaCov;

    const clampCI = (low: number, high: number, hardMax: number): [number, number] => {
        const lo = Number.isFinite(low) ? Math.max(0, low) : 0;
        const hi = Number.isFinite(high) ? Math.max(lo, high) : lo;
        return [Math.min(lo, hardMax), Math.min(hi, hardMax)];
    };

    const e2Adjusted = new Array<number>(n);
    const ci95Low = new Array<number>(n);
    const ci95High = new Array<number>(n);
    const ci68Low = new Array<number>(n);
    const ci68High = new Array<number>(n);

    if (calibrationModel === 'ou-kalman') {
        const ou = buildOUKalmanCalibration(sim, labResults);

        for (let i = 0; i < n; i++) {
            const c0 = Math.max(sim.concPGmL_E2[i], EKF_EPS);
            const mean = ou.m[i];
            const std = Math.sqrt(Math.max(0, ou.P[i]));

            e2Adjusted[i] = Math.min(c0 * Math.exp(mean + 0.5 * ou.P[i]), EKF_CI_MAX_E2);

            const [lo95, hi95] = clampCI(
                c0 * Math.exp(mean - 1.96 * std),
                c0 * Math.exp(mean + 1.96 * std),
                EKF_CI_MAX_E2
            );
            ci95Low[i] = lo95;
            ci95High[i] = hi95;

            const [lo68, hi68] = clampCI(
                c0 * Math.exp(mean - std),
                c0 * Math.exp(mean + std),
                EKF_CI_MAX_E2
            );
            ci68Low[i] = lo68;
            ci68High[i] = hi68;
        }
    } else {
        const ekfStep = Math.max(1, Math.floor(n / 100));
        const ekfIndices: number[] = [];
        for (let i = 0; i < n; i += ekfStep) ekfIndices.push(i);
        if (ekfIndices[ekfIndices.length - 1] !== n - 1) ekfIndices.push(n - 1);

        const ekfSamples: {
            idx: number;
            e2Adj: number;
            ci95Lo: number;
            ci95Hi: number;
            ci68Lo: number;
            ci68Hi: number;
        }[] = [];

        for (const idx of ekfIndices) {
            const timeH = sim.timeH[idx];
            const e2Base = computeE2AtTimeWithTheta(events, weight, timeH, theta);
            const yhat = Math.log(Math.max(e2Base, EKF_EPS));
            const thetaKPlus: [number, number] = [theta[0], theta[1] + EKF_DELTA_K];
            const yhatPlus = Math.log(Math.max(computeE2AtTimeWithTheta(events, weight, timeH, thetaKPlus), EKF_EPS));
            const H1 = (yhatPlus - yhat) / EKF_DELTA_K;
            const rawSigma2Param = P[0][0] + 2 * H1 * P[0][1] + H1 * H1 * P[1][1];
            const sigma2Param = Number.isFinite(rawSigma2Param) && rawSigma2Param > 0 ? rawSigma2Param : 0;
            const sigmaTotal = Math.sqrt(sigma2Param + EKF_SIGMA_RESIDUAL_LOG * EKF_SIGMA_RESIDUAL_LOG);
            const e2AdjMean = Math.min(e2Base * Math.exp(0.5 * sigma2Param), EKF_CI_MAX_E2);
            const [lo95, hi95] = clampCI(
                e2Base * Math.exp(-1.96 * sigmaTotal),
                e2Base * Math.exp(1.96 * sigmaTotal),
                EKF_CI_MAX_E2
            );
            const [lo68, hi68] = clampCI(
                e2Base * Math.exp(-sigmaTotal),
                e2Base * Math.exp(sigmaTotal),
                EKF_CI_MAX_E2
            );
            ekfSamples.push({ idx, e2Adj: e2AdjMean, ci95Lo: lo95, ci95Hi: hi95, ci68Lo: lo68, ci68Hi: hi68 });
        }

        for (let j = 0; j < ekfSamples.length; j++) {
            const a = ekfSamples[j];
            const b = ekfSamples[j + 1] ?? a;
            const span = b.idx - a.idx;
            for (let i = a.idx; i <= b.idx; i++) {
                const frac = span > 0 ? (i - a.idx) / span : 0;
                e2Adjusted[i] = Math.min(Math.max(0, a.e2Adj + (b.e2Adj - a.e2Adj) * frac), EKF_CI_MAX_E2);
                ci95Low[i] = a.ci95Lo + (b.ci95Lo - a.ci95Lo) * frac;
                ci95High[i] = a.ci95Hi + (b.ci95Hi - a.ci95Hi) * frac;
                ci68Low[i] = a.ci68Lo + (b.ci68Lo - a.ci68Lo) * frac;
                ci68High[i] = a.ci68Hi + (b.ci68Hi - a.ci68Hi) * frac;
            }
        }
    }

    const step = Math.max(1, Math.floor(n / 100));
    const sampledIndices: number[] = [];
    for (let i = 0; i < n; i += step) sampledIndices.push(i);
    if (sampledIndices[sampledIndices.length - 1] !== n - 1) sampledIndices.push(n - 1);

    const cpaSamples: {
        idx: number;
        cpaAdj: number;
        cpaCi95Low: number;
        cpaCi95High: number;
    }[] = [];

    for (const idx of sampledIndices) {
        const timeH = sim.timeH[idx];
        const cpaPred = applyE2LearningToCPA
            ? computeCPAAtTimeWithTheta(events, weight, timeH, theta)
            : computeCPAAtTimeWithTheta(events, weight, timeH, [0, 0]);

        const adherenceVar = applyE2LearningToCPA ? Math.max(0, P[0][0]) : 0;
        const varLogCPA = adherenceVar + CPA_2COMP_PK.popLogVar;
        const stdCPA = Math.sqrt(Math.max(0, varLogCPA));
        const yhatCPA = Math.log(Math.max(cpaPred, EKF_EPS_CPA));
        const [cpaCiLow, cpaCiHigh] = clampCI(
            Math.exp(yhatCPA - 1.96 * stdCPA),
            Math.exp(yhatCPA + 1.96 * stdCPA),
            EKF_CI_MAX_CPA
        );

        cpaSamples.push({ idx, cpaAdj: cpaPred, cpaCi95Low: cpaCiLow, cpaCi95High: cpaCiHigh });
    }

    const cpaAdjusted = new Array<number>(n).fill(0);
    const cpaCi95Low = new Array<number>(n).fill(0);
    const cpaCi95High = new Array<number>(n).fill(0);

    for (let j = 0; j < cpaSamples.length; j++) {
        const a = cpaSamples[j];
        const b = cpaSamples[j + 1] ?? a;
        const span = b.idx - a.idx;
        for (let i = a.idx; i <= b.idx; i++) {
            const frac = span > 0 ? (i - a.idx) / span : 0;
            cpaAdjusted[i] = a.cpaAdj + (b.cpaAdj - a.cpaAdj) * frac;
            cpaCi95Low[i] = a.cpaCi95Low + (b.cpaCi95Low - a.cpaCi95Low) * frac;
            cpaCi95High[i] = a.cpaCi95High + (b.cpaCi95High - a.cpaCi95High) * frac;
        }
    }

    if (applyCPAInhibitionToE2) {
        for (let i = 0; i < n; i++) {
            const inhibition = computeCPAE2InhibitionFactor(cpaAdjusted[i]);
            const scale = 1 / (1 - inhibition);
            e2Adjusted[i] = Math.min(e2Adjusted[i] * scale, EKF_CI_MAX_E2);

            const s95Lo = ci95Low[i] * scale;
            const s95Hi = Math.min(ci95High[i] * scale, EKF_CI_MAX_E2);
            const s68Lo = ci68Low[i] * scale;
            const s68Hi = Math.min(ci68High[i] * scale, EKF_CI_MAX_E2);
            ci95Low[i] = Math.min(s95Lo, s95Hi);
            ci95High[i] = s95Hi;
            ci68Low[i] = Math.min(s68Lo, s68Hi);
            ci68High[i] = s68Hi;
        }
    }

    return {
        timeH: sim.timeH,
        e2Adjusted,
        ci95Low,
        ci95High,
        ci68Low,
        ci68High,
        cpaAdjusted,
        cpaCi95Low,
        cpaCi95High,
    };
}
