import { Route, Ester, ExtraKey, type DoseEvent, type SimulationResult } from './types.js';

/**
 * Route-specific metadata for transdermal gel absorption.
 *
 * These definitions live in the PK module because they directly affect
 * bioavailability calculations and are not useful outside the simulation layer.
 */
enum GelSite {
    arm = "arm",
    thigh = "thigh",
    scrotal = "scrotal"
}

const GEL_SITE_ORDER = ["arm", "thigh", "scrotal"] as const;

const GelSiteParams = {
    [GelSite.arm]: 0.05,
    [GelSite.thigh]: 0.05,
    [GelSite.scrotal]: 0.40
};

/**
 * Shared PK constants used by the population model.
 *
 * These are exported because the personal-model code in `logic.ts` still builds
 * on top of the same physiological assumptions and needs direct access to them.
 */
export const CorePK = {
    vdPerKG: 2.0,
    /** @deprecated Use CPA_2COMP_PK.V1_per_kg (central Vc) instead of this apparent Vd */
    vdPerKG_CPA: 14.0,
    kClear: 0.41,
    kClearInjection: 0.041,
    depotK1Corr: 1.0
};

/**
 * CPA 2-compartment oral PK constants derived from SmPC (Diane-35 / Androcur).
 *
 * Exported so higher-level calibration code can reuse the same population
 * variance and central-compartment assumptions without duplicating numbers.
 */
export const CPA_2COMP_PK = {
    F: 0.88,
    ka: 0.5,
    alpha: 0.8660,
    beta: 0.01031,
    k21: 0.03034,
    V1_per_kg: 0.734,
    popLogVar: 0.09,
};

const EsterInfo = {
    [Ester.E2]: { name: "Estradiol", mw: 272.38 },
    [Ester.EB]: { name: "Estradiol Benzoate", mw: 376.50 },
    [Ester.EV]: { name: "Estradiol Valerate", mw: 356.50 },
    [Ester.EC]: { name: "Estradiol Cypionate", mw: 396.58 },
    [Ester.EN]: { name: "Estradiol Enanthate", mw: 384.56 },
    [Ester.CPA]: { name: "Cyproterone Acetate", mw: 416.94 }
};

/**
 * Convert a compound / ester dose into estradiol-equivalent molar mass scaling.
 */
export function getToE2Factor(ester: Ester): number {
    if (ester === Ester.E2) return 1.0;
    return EsterInfo[Ester.E2].mw / EsterInfo[ester].mw;
}

const TwoPartDepotPK: {
    Frac_fast: Partial<Record<Ester, number>>,
    k1_fast: Partial<Record<Ester, number>>,
    k1_slow: Partial<Record<Ester, number>>
} = {
    Frac_fast: { [Ester.EB]: 0.90, [Ester.EV]: 0.40, [Ester.EC]: 0.229164549, [Ester.EN]: 0.05, [Ester.E2]: 1.0 },
    k1_fast: { [Ester.EB]: 0.144, [Ester.EV]: 0.0216, [Ester.EC]: 0.005035046, [Ester.EN]: 0.0010, [Ester.E2]: 0.5 },
    k1_slow: { [Ester.EB]: 0.114, [Ester.EV]: 0.0138, [Ester.EC]: 0.004510574, [Ester.EN]: 0.0050, [Ester.E2]: 0 }
};

const InjectionPK: {
    formationFraction: Partial<Record<Ester, number>>
} = {
    formationFraction: { [Ester.EB]: 0.1092, [Ester.EV]: 0.0623, [Ester.EC]: 0.1173, [Ester.EN]: 0.12, [Ester.E2]: 1.0 }
};

const EsterPK: {
    k2: Partial<Record<Ester, number>>
} = {
    k2: { [Ester.EB]: 0.090, [Ester.EV]: 0.070, [Ester.EC]: 0.045, [Ester.EN]: 0.015, [Ester.E2]: 0 }
};

const OralPK = {
    kAbsE2: 0.32,
    kAbsEV: 0.05,
    bioavailability: 0.03,
    kAbsSL: 1.8
};

// Deterministic ordering keeps the serialized tier index stable across UI and PK code.
export const SL_TIER_ORDER = ["quick", "casual", "standard", "strict"] as const;

export const SublingualTierParams = {
    quick: { theta: 0.01, hold: 2 },
    casual: { theta: 0.04, hold: 5 },
    standard: { theta: 0.11, hold: 10 },
    strict: { theta: 0.18, hold: 15 }
};

/**
 * Route-specific bioavailability multiplier used to map recorded dose to
 * systemically available hormone amount.
 *
 * This function is intentionally exported because both UI helpers and PK logic
 * need to agree on the same route-specific conversion rules.
 */
export function getBioavailabilityMultiplier(
    route: Route,
    ester: Ester,
    extras: Partial<Record<ExtraKey, number>> = {}
): number {
    const mwFactor = getToE2Factor(ester);

    switch (route) {
        case Route.injection: {
            const formation = InjectionPK.formationFraction[ester] ?? 0.08;
            return formation * mwFactor;
        }
        case Route.oral:
            return OralPK.bioavailability * mwFactor;
        case Route.sublingual: {
            let theta = 0.11;
            if (extras[ExtraKey.sublingualTheta] !== undefined) {
                const customTheta = extras[ExtraKey.sublingualTheta];
                if (typeof customTheta === 'number' && Number.isFinite(customTheta)) {
                    theta = Math.min(1, Math.max(0, customTheta));
                }
            } else if (extras[ExtraKey.sublingualTier] !== undefined) {
                const tierIdx = Math.min(SL_TIER_ORDER.length - 1, Math.max(0, Math.round(extras[ExtraKey.sublingualTier]!)));
                const tierKey = SL_TIER_ORDER[tierIdx] || 'standard';
                theta = SublingualTierParams[tierKey]?.theta ?? 0.11;
            }
            return (theta + (1 - theta) * OralPK.bioavailability) * mwFactor;
        }
        case Route.gel: {
            const siteIdx = Math.min(GEL_SITE_ORDER.length - 1, Math.max(0, Math.round(extras[ExtraKey.gelSite] ?? 0)));
            const siteKey = GEL_SITE_ORDER[siteIdx] ?? GelSite.arm;
            const bio = GelSiteParams[siteKey] ?? 0.05;
            return bio * mwFactor;
        }
        case Route.patchApply:
            return 1.0 * mwFactor;
        case Route.patchRemove:
        default:
            return 0;
    }
}

interface PKParams {
    Frac_fast: number;
    k1_fast: number;
    k1_slow: number;
    k2: number;
    k3: number;
    F: number;
    rateMGh: number;
    F_fast: number;
    F_slow: number;
}

/**
 * Resolve one dose event into the low-level PK parameters used by the solvers.
 *
 * Exported because the EKF layer reuses the same route-specific model, but with
 * a learned clearance scaling applied on top.
 */
export function resolveParams(event: DoseEvent): PKParams {
    const defaultK3 = event.route === Route.injection ? CorePK.kClearInjection : CorePK.kClear;
    const toE2 = getToE2Factor(event.ester);
    const extras = event.extras ?? {};

    switch (event.route) {
        case Route.injection: {
            const Frac_fast = TwoPartDepotPK.Frac_fast[event.ester] ?? 0.5;
            const k1_fast = (TwoPartDepotPK.k1_fast[event.ester] ?? 0.1) * CorePK.depotK1Corr;
            const k1_slow = (TwoPartDepotPK.k1_slow[event.ester] ?? 0.01) * CorePK.depotK1Corr;
            const k2 = EsterPK.k2[event.ester] ?? 0;
            const F = getBioavailabilityMultiplier(Route.injection, event.ester, extras);
            return { Frac_fast, k1_fast, k1_slow, k2, k3: defaultK3, F, rateMGh: 0, F_fast: F, F_slow: F };
        }

        case Route.sublingual: {
            let theta = 0.11;
            if (extras[ExtraKey.sublingualTheta] !== undefined) {
                const customTheta = extras[ExtraKey.sublingualTheta];
                if (typeof customTheta === 'number' && Number.isFinite(customTheta)) {
                    theta = Math.min(1, Math.max(0, customTheta));
                }
            } else if (extras[ExtraKey.sublingualTier] !== undefined) {
                const tierRaw = extras[ExtraKey.sublingualTier];
                if (typeof tierRaw === 'number' && Number.isFinite(tierRaw)) {
                    const tierIdx = Math.min(SL_TIER_ORDER.length - 1, Math.max(0, Math.round(tierRaw)));
                    const tierKey = SL_TIER_ORDER[tierIdx] || 'standard';
                    theta = SublingualTierParams[tierKey]?.theta ?? theta;
                }
            }
            const k1_fast = OralPK.kAbsSL;
            const k1_slow = event.ester === Ester.EV ? OralPK.kAbsEV : OralPK.kAbsE2;
            const k2 = EsterPK.k2[event.ester] ?? 0;
            const F_fast = toE2;
            const F_slow = OralPK.bioavailability * toE2;
            const F = theta * F_fast + (1 - theta) * F_slow;
            return { Frac_fast: theta, k1_fast, k1_slow, k2, k3: defaultK3, F, rateMGh: 0, F_fast, F_slow };
        }

        case Route.gel: {
            const F = getBioavailabilityMultiplier(Route.gel, event.ester, extras);
            const k1 = 0.022;
            return { Frac_fast: 1.0, k1_fast: k1, k1_slow: 0, k2: 0, k3: defaultK3, F, rateMGh: 0, F_fast: F, F_slow: F };
        }

        case Route.patchApply: {
            const F = getBioavailabilityMultiplier(Route.patchApply, event.ester, extras);
            const releaseRateUGPerDay = extras[ExtraKey.releaseRateUGPerDay];
            const rateMGh = (typeof releaseRateUGPerDay === 'number' && Number.isFinite(releaseRateUGPerDay) && releaseRateUGPerDay > 0)
                ? (releaseRateUGPerDay / 24 / 1000) * F
                : 0;
            if (rateMGh > 0) {
                return { Frac_fast: 1.0, k1_fast: 0, k1_slow: 0, k2: 0, k3: defaultK3, F, rateMGh, F_fast: F, F_slow: F };
            }
            const k1 = 0.0075;
            return { Frac_fast: 1.0, k1_fast: k1, k1_slow: 0, k2: 0, k3: defaultK3, F, rateMGh: 0, F_fast: F, F_slow: F };
        }

        case Route.patchRemove:
            return { Frac_fast: 0, k1_fast: 0, k1_slow: 0, k2: 0, k3: defaultK3, F: 0, rateMGh: 0, F_fast: 0, F_slow: 0 };

        case Route.oral: {
            if (event.ester === Ester.CPA) {
                return {
                    Frac_fast: 1.0,
                    k1_fast: 1.0,
                    k1_slow: 0,
                    k2: 0,
                    k3: 0.017,
                    F: 0.7,
                    rateMGh: 0,
                    F_fast: 0.7,
                    F_slow: 0.7
                };
            }

            const k1Value = event.ester === Ester.EV ? OralPK.kAbsEV : OralPK.kAbsE2;
            const k2Value = event.ester === Ester.EV ? (EsterPK.k2[Ester.EV] || 0) : 0;
            const F = OralPK.bioavailability * toE2;
            return { Frac_fast: 1.0, k1_fast: k1Value, k1_slow: 0, k2: k2Value, k3: defaultK3, F, rateMGh: 0, F_fast: F, F_slow: F };
        }
    }

    return { Frac_fast: 0, k1_fast: 0, k1_slow: 0, k2: 0, k3: defaultK3, F: 0, rateMGh: 0, F_fast: 0, F_slow: 0 };
}

/**
 * Analytical single-dose oral CPA solution for the central compartment.
 *
 * Exported so the individualized CPA prediction in `logic.ts` can reuse the
 * exact same population model as the baseline simulation.
 */
export function compute2CompCPACentralAmount(doseMG: number, tau: number): number {
    if (tau < 0 || doseMG <= 0) return 0;
    const { F, ka, alpha, beta, k21 } = CPA_2COMP_PK;
    const eps = 1e-8;
    if (Math.abs(alpha - ka) < eps || Math.abs(beta - ka) < eps || Math.abs(alpha - beta) < eps) {
        if (Math.abs(ka - beta) < eps) return Math.max(0, doseMG * F * ka * tau * Math.exp(-beta * tau));
        return Math.max(0, doseMG * F * ka / (ka - beta) * (Math.exp(-beta * tau) - Math.exp(-ka * tau)));
    }
    const A = (k21 - ka) / ((alpha - ka) * (beta - ka));
    const B = (k21 - alpha) / ((ka - alpha) * (beta - alpha));
    const C = (k21 - beta) / ((ka - beta) * (alpha - beta));
    const val = doseMG * F * ka * (
        A * Math.exp(-ka * tau) +
        B * Math.exp(-alpha * tau) +
        C * Math.exp(-beta * tau)
    );
    return Math.max(0, val);
}

/**
 * Closed-form 3-compartment amount model used by the injectable and EV routes.
 */
export function _analytic3C(tau: number, doseMG: number, F: number, k1: number, k2: number, k3: number): number {
    if (k1 <= 0 || doseMG <= 0) return 0;
    const k1_k2 = k1 - k2;
    const k1_k3 = k1 - k3;
    const k2_k3 = k2 - k3;

    if (Math.abs(k1_k2) < 1e-9 || Math.abs(k1_k3) < 1e-9 || Math.abs(k2_k3) < 1e-9) return 0;

    const term1 = Math.exp(-k1 * tau) / (k1_k2 * k1_k3);
    const term2 = Math.exp(-k2 * tau) / (-k1_k2 * k2_k3);
    const term3 = Math.exp(-k3 * tau) / (k1_k3 * k2_k3);

    return doseMG * F * k1 * k2 * (term1 + term2 + term3);
}

/**
 * Standard one-compartment first-order absorption / elimination solution.
 */
export function oneCompAmount(tau: number, doseMG: number, p: PKParams): number {
    const k1 = p.k1_fast;
    if (Math.abs(k1 - p.k3) < 1e-9) {
        return doseMG * p.F * k1 * tau * Math.exp(-p.k3 * tau);
    }
    return doseMG * p.F * k1 / (k1 - p.k3) * (Math.exp(-p.k3 * tau) - Math.exp(-k1 * tau));
}

/**
 * Precomputed per-event model wrapper.
 *
 * The class is kept local to this file because it is only an implementation
 * detail of `runSimulation` and does not need to leak into the rest of the app.
 */
class PrecomputedEventModel {
    private model: (t: number) => number;

    constructor(event: DoseEvent, allEvents: DoseEvent[]) {
        const params = resolveParams(event);
        const startTime = event.timeH;
        const dose = event.doseMG;

        switch (event.route) {
            case Route.injection:
                this.model = (timeH: number) => {
                    const tau = timeH - startTime;
                    if (tau < 0) return 0;
                    const doseFast = dose * params.Frac_fast;
                    const doseSlow = dose * (1.0 - params.Frac_fast);

                    return _analytic3C(tau, doseFast, params.F, params.k1_fast, params.k2, params.k3) +
                        _analytic3C(tau, doseSlow, params.F, params.k1_slow, params.k2, params.k3);
                };
                break;
            case Route.gel:
            case Route.oral:
                this.model = (timeH: number) => {
                    const tau = timeH - startTime;
                    if (tau < 0) return 0;
                    if (event.ester === Ester.CPA) {
                        return compute2CompCPACentralAmount(dose, tau);
                    }
                    return oneCompAmount(tau, dose, params);
                };
                break;
            case Route.sublingual:
                this.model = (timeH: number) => {
                    const tau = timeH - startTime;
                    if (tau < 0) return 0;
                    if (params.k2 > 0) {
                        const doseF = dose * params.Frac_fast;
                        const doseS = dose * (1.0 - params.Frac_fast);
                        return _analytic3C(tau, doseF, params.F_fast, params.k1_fast, params.k2, params.k3) +
                            _analytic3C(tau, doseS, params.F_slow, params.k1_slow, params.k2, params.k3);
                    } else {
                        const doseF = dose * params.Frac_fast;
                        const doseS = dose * (1.0 - params.Frac_fast);

                        const branch = (d: number, F: number, ka: number, ke: number, t: number) => {
                            if (Math.abs(ka - ke) < 1e-9) return d * F * ka * t * Math.exp(-ke * t);
                            return d * F * ka / (ka - ke) * (Math.exp(-ke * t) - Math.exp(-ka * t));
                        };
                        return branch(doseF, params.F_fast, params.k1_fast, params.k3, tau) +
                            branch(doseS, params.F_slow, params.k1_slow, params.k3, tau);
                    }
                };
                break;
            case Route.patchApply: {
                const remove = allEvents.find(e => e.route === Route.patchRemove && e.timeH > startTime);
                const wearH = (remove?.timeH ?? Number.MAX_VALUE) - startTime;

                this.model = (timeH: number) => {
                    const tau = timeH - startTime;
                    if (tau < 0) return 0;

                    if (params.rateMGh > 0) {
                        if (tau <= wearH) {
                            return params.rateMGh / params.k3 * (1 - Math.exp(-params.k3 * tau));
                        } else {
                            const amtRemoval = params.rateMGh / params.k3 * (1 - Math.exp(-params.k3 * wearH));
                            return amtRemoval * Math.exp(-params.k3 * (tau - wearH));
                        }
                    }

                    const amtUnderPatch = oneCompAmount(tau, dose, params);
                    if (tau > wearH) {
                        const amtAtRemoval = oneCompAmount(wearH, dose, params);
                        return amtAtRemoval * Math.exp(-params.k3 * (tau - wearH));
                    }
                    return amtUnderPatch;
                };
                break;
            }
            default:
                this.model = () => 0;
        }
    }

    amount(timeH: number): number {
        return this.model(timeH);
    }
}

/**
 * Main deterministic population simulation engine.
 *
 * This function is kept pure: it only depends on the recorded events and body
 * weight, which makes it a stable foundation for later calibration layers.
 */
export function runSimulation(events: DoseEvent[], bodyWeightKG: number): SimulationResult | null {
    if (events.length === 0) return null;

    const sortedEvents = [...events].sort((a, b) => a.timeH - b.timeH);
    const precomputed = sortedEvents
        .filter(e => e.route !== Route.patchRemove)
        .map(e => ({ model: new PrecomputedEventModel(e, sortedEvents), ester: e.ester }));

    const startTime = sortedEvents[0].timeH - 24;
    const endTime = sortedEvents[sortedEvents.length - 1].timeH + (24 * 14);
    const steps = 1000;

    const plasmaVolumeML_E2 = CorePK.vdPerKG * bodyWeightKG * 1000;
    const plasmaVolumeML_CPA = CPA_2COMP_PK.V1_per_kg * bodyWeightKG * 1000;

    const timeH: number[] = [];
    const concPGmL: number[] = [];
    const concPGmL_E2: number[] = [];
    const concPGmL_CPA: number[] = [];
    let auc = 0;

    const stepSize = (endTime - startTime) / (steps - 1);

    for (let i = 0; i < steps; i++) {
        const t = startTime + i * stepSize;
        let totalAmountMG_E2 = 0;
        let totalAmountMG_CPA = 0;

        for (const { model, ester } of precomputed) {
            const amount = model.amount(t);
            if (ester === Ester.CPA) {
                totalAmountMG_CPA += amount;
            } else {
                totalAmountMG_E2 += amount;
            }
        }

        const currentConc_E2 = (totalAmountMG_E2 * 1e9) / plasmaVolumeML_E2;
        const currentConc_CPA = (totalAmountMG_CPA * 1e6) / plasmaVolumeML_CPA;
        const currentConc = currentConc_E2 + (currentConc_CPA * 1000);

        timeH.push(t);
        concPGmL.push(currentConc);
        concPGmL_E2.push(currentConc_E2);
        concPGmL_CPA.push(currentConc_CPA);

        if (i > 0) {
            auc += 0.5 * (currentConc + concPGmL[i - 1]) * stepSize;
        }
    }

    return { timeH, concPGmL, concPGmL_E2, concPGmL_CPA, auc };
}

/**
 * Shared linear interpolation helper for simulation curves.
 *
 * Keeping the search / interpolation logic in one place avoids subtle drift
 * between total, E2-only, and CPA-only views.
 */
function interpolateSeries(
    timeH: number[],
    conc: number[],
    hour: number
): number | null {
    if (!timeH.length) return null;
    if (hour <= timeH[0]) return conc[0];
    if (hour >= timeH[timeH.length - 1]) return conc[conc.length - 1];

    let low = 0;
    let high = timeH.length - 1;

    while (high - low > 1) {
        const mid = Math.floor((low + high) / 2);
        if (timeH[mid] === hour) return conc[mid];
        if (timeH[mid] < hour) low = mid;
        else high = mid;
    }

    const t0 = timeH[low];
    const t1 = timeH[high];
    const c0 = conc[low];
    const c1 = conc[high];

    if (t1 === t0) return c0;
    const ratio = (hour - t0) / (t1 - t0);
    return c0 + (c1 - c0) * ratio;
}

export function interpolateConcentration(sim: SimulationResult, hour: number): number | null {
    return interpolateSeries(sim.timeH, sim.concPGmL, hour);
}

export function interpolateConcentration_E2(sim: SimulationResult, hour: number): number | null {
    return interpolateSeries(sim.timeH, sim.concPGmL_E2, hour);
}

export function interpolateConcentration_CPA(sim: SimulationResult, hour: number): number | null {
    return interpolateSeries(sim.timeH, sim.concPGmL_CPA, hour);
}
