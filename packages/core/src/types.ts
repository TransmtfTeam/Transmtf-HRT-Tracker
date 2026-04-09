/**
 * Shared domain types for the HRT tracker.
 *
 * This file is intentionally limited to enums, interfaces, and other
 * "shape-only" definitions that describe the data model used across the app.
 * Keeping these definitions in one place makes later refactors safer because
 * UI code, persistence code, and PK logic can all agree on the same contract.
 */

/**
 * Supported administration routes for tracked medication events.
 *
 * Notes:
 * - `patchApply` and `patchRemove` are modeled as separate event kinds so the
 *   timeline can represent both applying and removing a patch explicitly.
 * - Route names are serialized to storage, so they should remain stable.
 */
export enum Route {
    injection = "injection",
    patchApply = "patchApply",
    patchRemove = "patchRemove",
    gel = "gel",
    oral = "oral",
    sublingual = "sublingual"
}

/**
 * Compounds / esters currently supported by the pharmacokinetic model.
 *
 * The enum values are also persisted in exported data, so keeping them short
 * and stable helps preserve backwards compatibility.
 */
export enum Ester {
    E2 = "E2",
    EB = "EB",
    EV = "EV",
    EC = "EC",
    EN = "EN",
    CPA = "CPA"
}

/**
 * Optional per-event metadata keys stored inside `DoseEvent.extras`.
 *
 * These remain numeric so they are easy to serialize, validate, and pass into
 * the PK formulas without additional parsing layers.
 */
export enum ExtraKey {
    concentrationMGmL = "concentrationMGmL",
    areaCM2 = "areaCM2",
    releaseRateUGPerDay = "releaseRateUGPerDay",
    sublingualTheta = "sublingualTheta",
    sublingualTier = "sublingualTier",
    gelSite = "gelSite"
}

/**
 * A single medication event entered by the user.
 *
 * `doseMG` stores the administered compound amount in mg. For esterified forms
 * this is the ester/compound dose, not the estradiol-equivalent dose. Any
 * route-specific settings live in `extras`.
 */
export interface DoseEvent {
    id: string;
    route: Route;
    timeH: number; // Hours since 1970
    doseMG: number; // Dose in mg (of the ester/compound), NOT E2-equivalent
    ester: Ester;
    extras: Partial<Record<ExtraKey, number>>;
}

/**
 * Raw simulation output on the shared time grid.
 *
 * The engine keeps total concentration plus route-specific E2 / CPA component
 * curves so the UI can display combined or separated views without re-running
 * the full simulation.
 */
export interface SimulationResult {
    timeH: number[];
    concPGmL: number[];
    concPGmL_E2: number[];
    concPGmL_CPA: number[];
    auc: number;
}

/**
 * A laboratory measurement entered by the user.
 *
 * The value is stored in the unit originally entered by the user so the app
 * can preserve display intent, while conversion helpers can normalize it for
 * modeling when needed.
 */
export interface LabResult {
    id: string;
    timeH: number;
    concValue: number; // Value in the user's unit
    unit: 'pg/ml' | 'pmol/l';
}
