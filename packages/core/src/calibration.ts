import { type LabResult, type SimulationResult } from './types.js';
import { interpolateConcentration_E2 } from './pk.js';

/**
 * Convert a lab value into pg/mL, which is the internal unit used by the
 * calibration and learning layers.
 */
export function convertToPgMl(val: number, unit: 'pg/ml' | 'pmol/l'): number {
    if (unit === 'pg/ml') return val;
    return val / 3.671;
}

/**
 * Build a lightweight ratio-based calibration interpolator from lab results.
 *
 * This is the legacy calibration path still used by some display flows. It is
 * intentionally kept separate from the Bayesian calibration model so we can
 * preserve backwards compatibility while making the architecture clearer.
 */
export function createCalibrationInterpolator(sim: SimulationResult | null, results: LabResult[]) {
    if (!sim || !results.length) return (_timeH: number) => 1;

    const getNearestConcE2 = (timeH: number): number | null => {
        if (!sim.timeH.length) return null;
        let low = 0;
        let high = sim.timeH.length - 1;
        while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (sim.timeH[mid] === timeH) return sim.concPGmL_E2[mid];
            if (sim.timeH[mid] < timeH) low = mid;
            else high = mid;
        }
        const idx = Math.abs(sim.timeH[high] - timeH) < Math.abs(sim.timeH[low] - timeH) ? high : low;
        return sim.concPGmL_E2[idx];
    };

    const points = results
        .map((result) => {
            const obs = convertToPgMl(result.concValue, result.unit);
            let pred = interpolateConcentration_E2(sim, result.timeH);
            if (pred === null || Number.isNaN(pred)) {
                pred = getNearestConcE2(result.timeH);
            }
            if (pred === null || pred <= 0.01 || obs <= 0) return null;
            return {
                timeH: result.timeH,
                ratio: Math.max(0.1, Math.min(10, obs / pred)),
            };
        })
        .filter((point): point is { timeH: number; ratio: number } => point !== null)
        .sort((a, b) => a.timeH - b.timeH);

    if (!points.length) return (_timeH: number) => 1;
    if (points.length === 1) {
        const fixedRatio = points[0].ratio;
        return (_timeH: number) => fixedRatio;
    }

    return (timeH: number) => {
        if (timeH <= points[0].timeH) return points[0].ratio;
        if (timeH >= points[points.length - 1].timeH) return points[points.length - 1].ratio;

        let low = 0;
        let high = points.length - 1;
        while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (points[mid].timeH === timeH) return points[mid].ratio;
            if (points[mid].timeH < timeH) low = mid;
            else high = mid;
        }

        const left = points[low];
        const right = points[high];
        const t = (timeH - left.timeH) / (right.timeH - left.timeH);
        const ratio = left.ratio + (right.ratio - left.ratio) * t;
        return Math.max(0.1, Math.min(10, ratio));
    };
}

/** Which Bayesian model to use for E2 calibration and CI bands. */
export type CalibrationModel = 'ekf' | 'ou-kalman';

export interface OUCalibParams {
    tau: number;
    Theta: number;
    sigma: number;
    mu: number;
}

/** Default OU calibration parameters anchored to estradiol assay literature. */
export const OU_DEFAULT_PARAMS: OUCalibParams = {
    tau: 0.198,
    Theta: Math.LN2 / (7 * 24),
    sigma: 0.02,
    mu: 0.0,
};

/**
 * Ornstein-Uhlenbeck Kalman filter plus RTS smoother for dynamic E2
 * calibration. The output is aligned with `sim.timeH`.
 */
export function buildOUKalmanCalibration(
    sim: SimulationResult,
    labResults: LabResult[],
    params: OUCalibParams = OU_DEFAULT_PARAMS
): { m: number[]; P: number[] } {
    const n = sim.timeH.length;
    if (n === 0) return { m: [], P: [] };

    const { tau, Theta, sigma, mu } = params;
    const tau2 = tau * tau;
    const pInf = (sigma * sigma) / (2 * Theta);
    const eps = 0.1;

    const tMin = sim.timeH[0];
    const tMax = sim.timeH[n - 1];
    const labs: { timeH: number; z: number }[] = [];

    for (const lab of labResults) {
        if (lab.timeH < tMin || lab.timeH > tMax) continue;
        const obs = convertToPgMl(lab.concValue, lab.unit);
        if (obs <= 0) continue;
        const c0 = interpolateConcentration_E2(sim, lab.timeH);
        if (c0 === null || c0 < eps) continue;
        const z = Math.log(obs) - Math.log(c0);
        if (!Number.isFinite(z) || Math.abs(z) > 3.5) continue;
        labs.push({ timeH: lab.timeH, z });
    }
    labs.sort((a, b) => a.timeH - b.timeH);

    const gridSet = new Set<number>(sim.timeH);
    for (const lab of labs) gridSet.add(lab.timeH);
    const grid = Array.from(gridSet).sort((a, b) => a - b);
    const gridIndex = new Map<number, number>();
    for (let i = 0; i < grid.length; i++) gridIndex.set(grid[i], i);

    const mFwd = new Float64Array(grid.length).fill(mu);
    const pFwd = new Float64Array(grid.length).fill(pInf);
    const mPred = new Float64Array(grid.length).fill(mu);
    const pPred = new Float64Array(grid.length).fill(pInf);

    let m = mu;
    let p = pInf;
    let labPtr = 0;

    for (let i = 0; i < grid.length; i++) {
        if (i > 0) {
            const dt = grid[i] - grid[i - 1];
            if (dt > 0) {
                const phi = Math.exp(-Theta * dt);
                const q = pInf * (1 - phi * phi);
                m = mu + phi * (m - mu);
                p = phi * phi * p + q;
            }
        }

        mPred[i] = m;
        pPred[i] = p;

        while (labPtr < labs.length && labs[labPtr].timeH === grid[i]) {
            const s = p + tau2;
            const k = p / s;
            m = m + k * (labs[labPtr].z - m);
            p = (1 - k) * p;
            labPtr++;
        }

        mFwd[i] = m;
        pFwd[i] = Math.max(p, 1e-12);
    }

    const mSmooth = Float64Array.from(mFwd);
    const pSmooth = Float64Array.from(pFwd);

    for (let i = grid.length - 2; i >= 0; i--) {
        const dt = grid[i + 1] - grid[i];
        if (dt <= 0) continue;
        const phi = Math.exp(-Theta * dt);
        const gain = pPred[i + 1] > 1e-12 ? pFwd[i] * phi / pPred[i + 1] : 0;
        mSmooth[i] = mFwd[i] + gain * (mSmooth[i + 1] - mPred[i + 1]);
        pSmooth[i] = Math.max(pFwd[i] + gain * gain * (pSmooth[i + 1] - pPred[i + 1]), 1e-9);
    }

    const outM = new Array<number>(n);
    const outP = new Array<number>(n);
    for (let i = 0; i < n; i++) {
        const idx = gridIndex.get(sim.timeH[i]);
        if (idx !== undefined) {
            outM[i] = mSmooth[idx];
            outP[i] = pSmooth[idx];
        } else {
            outM[i] = mu;
            outP[i] = pInf;
        }
    }

    return { m: outM, P: outP };
}
