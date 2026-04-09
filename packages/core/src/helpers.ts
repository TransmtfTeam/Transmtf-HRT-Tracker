import { Route, DoseEvent, Ester, ExtraKey } from './types.js';
import { getBioavailabilityMultiplier, getToE2Factor } from './pk.js';

/**
 * 计算生物利用度后的剂量 (mg)
 */
export const getBioDoseMG = (event: DoseEvent): number => {
    const multiplier = getBioavailabilityMultiplier(event.route, event.ester, event.extras || {});
    return multiplier * event.doseMG;
};

/**
 * 计算原始剂量 (mg)，即 E2 等效剂量
 */
export const getRawDoseMG = (event: DoseEvent): number | null => {
    if (event.route === Route.patchRemove) return null;
    if (event.extras[ExtraKey.releaseRateUGPerDay]) return null;
    const factor = getToE2Factor(event.ester);
    if (!factor) return event.doseMG;
    return event.doseMG / factor;
};
