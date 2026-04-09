import React, { useMemo } from 'react';
import { Activity, Settings, Info } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import ResultChart from '../components/ResultChart';
import { DoseEvent, SimulationResult, LabResult, interpolateConcentration_E2, interpolateConcentration_CPA, convertToPgMl } from '../../logic';

interface SimCI {
    timeH: number[];
    e2Adjusted: number[];
    ci95Low: number[];
    ci95High: number[];
    ci68Low: number[];
    ci68High: number[];
    cpaAdjusted: number[];
    cpaCi95Low: number[];
    cpaCi95High: number[];
}

interface OverviewViewProps {
  events: DoseEvent[];
  weight: number;
  labResults: LabResult[];
  simulation: SimulationResult | null;
  currentTime: Date;
  simCI?: SimCI | null;
  onEditEvent: (event: DoseEvent) => void;
  onOpenWeightModal: () => void;
}

/** Linear interpolation on a parallel timeH/values array pair */
function interpAt(timeH: number[], values: number[], h: number): number {
  if (!timeH.length || !values.length) return 0;
  if (h <= timeH[0]) return values[0];
  if (h >= timeH[timeH.length - 1]) return values[values.length - 1];
  let lo = 0, hi = timeH.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (timeH[mid] <= h) lo = mid; else hi = mid;
  }
  const frac = (timeH[hi] - timeH[lo]) > 0
    ? (h - timeH[lo]) / (timeH[hi] - timeH[lo])
    : 0;
  const v = values[lo] + frac * (values[hi] - values[lo]);
  return isFinite(v) ? v : 0;
}

const OverviewView: React.FC<OverviewViewProps> = ({
  events,
  weight,
  labResults,
  simulation,
  currentTime,
  simCI,
  onEditEvent,
  onOpenWeightModal,
}) => {
  const { t, lang } = useTranslation();
  const h = currentTime.getTime() / 3600000;

  const hasPersonalModel = !!simCI && simCI.e2Adjusted.length > 0;
  const hasPersonalCpaModel = !!simCI && simCI.cpaAdjusted.length === simCI.timeH.length && simCI.cpaAdjusted.length > 0;
  const hasDoseHistory = events.length > 0;

  const rawLevel = useMemo(() => {
    if (!simulation) return 0;
    return interpolateConcentration_E2(simulation, h) || 0;
  }, [simulation, h]);

  // No dose history: use latest lab value as baseline observation for the headline card.
  const baselineLevel = useMemo(() => {
    if (hasDoseHistory || labResults.length === 0) return null;
    const latest = [...labResults].sort((a, b) => b.timeH - a.timeH)[0];
    const v = convertToPgMl(latest.concValue, latest.unit);
    return Number.isFinite(v) && v > 0 ? v : null;
  }, [hasDoseHistory, labResults]);

  const personalLevel = useMemo(() => {
    if (!hasPersonalModel) return null;
    const v = interpAt(simCI!.timeH, simCI!.e2Adjusted, h);
    return (v > 0 && v < 5000) ? v : null;
  }, [hasPersonalModel, simCI, h]);

  // E2: personal value preferred when available. If no dose history exists, show baseline lab value.
  const currentLevel = personalLevel ?? (rawLevel || baselineLevel || 0);

  // 95% CI bounds for E2 at current time
  const currentCI = useMemo(() => {
    if (!hasPersonalModel) return null;
    const lo = interpAt(simCI!.timeH, simCI!.ci95Low, h);
    const hi = interpAt(simCI!.timeH, simCI!.ci95High, h);
    if (lo > 0 && hi > 0 && hi > lo) return { lo, hi };
    return null;
  }, [hasPersonalModel, simCI, h]);

  const rawCPA = useMemo(() => {
    if (!simulation) return 0;
    return interpolateConcentration_CPA(simulation, h) || 0;
  }, [simulation, h]);

  const personalCPA = useMemo(() => {
    if (!hasPersonalCpaModel) return null;
    const v = interpAt(simCI!.timeH, simCI!.cpaAdjusted, h);
    return (v > 0 && v < 5000) ? v : null;
  }, [hasPersonalCpaModel, simCI, h]);

  const currentCPA = personalCPA ?? rawCPA;

  const currentCPACI = useMemo(() => {
    if (!hasPersonalCpaModel) return null;
    if (simCI!.cpaCi95Low.length !== simCI!.timeH.length || simCI!.cpaCi95High.length !== simCI!.timeH.length) {
      return null;
    }
    const lo = interpAt(simCI!.timeH, simCI!.cpaCi95Low, h);
    const hi = interpAt(simCI!.timeH, simCI!.cpaCi95High, h);
    if (lo > 0 && hi > 0 && hi > lo) return { lo, hi };
    return null;
  }, [hasPersonalCpaModel, simCI, h]);

  const getLevelStatus = (conc: number) => {
    if (conc > 300) return { label: 'status.level.high', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
    if (conc >= 100 && conc <= 200) return { label: 'status.level.mtf', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    if (conc >= 70 && conc <= 300) return { label: 'status.level.luteal', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' };
    if (conc >= 30 && conc < 70) return { label: 'status.level.follicular', color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' };
    if (conc >= 8 && conc < 30) return { label: 'status.level.male', color: 'text-gray-600', bg: 'bg-gray-50', border: 'border-gray-200' };
    return { label: 'status.level.low', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
  };

  const currentStatus = useMemo(() => {
    if (currentLevel > 0) return getLevelStatus(currentLevel);
    return null;
  }, [currentLevel]);

  const formatHeadlineE2 = (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(1));
  const formatHeadlineCPA = (v: number) => (v >= 10 ? v.toFixed(1) : v.toFixed(2));

  return (
    <>
      <header className="relative px-4 md:px-8 pt-6 pb-4">
        <div className="grid md:grid-cols-3 gap-3 md:gap-4">
          <div className="md:col-span-2 bg-white border border-gray-200 rounded-2xl shadow-sm px-5 py-5">
            <div className="flex items-center mb-3">
              <h1 className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gray-50 text-[11px] md:text-xs font-semibold text-gray-700 border border-gray-200">
                <Activity size={14} className="text-gray-500" />
                {t('status.estimate')}
                {hasPersonalModel && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-rose-50 text-rose-500 border border-rose-100">
                    {t('chart.personal_model')}
                  </span>
                )}
              </h1>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {/* E2 Display */}
              <div className="space-y-1">
                <div className="text-[10px] md:text-xs font-bold text-pink-400 uppercase tracking-wider">
                  E2
                </div>
                <div className="flex items-end gap-2">
                  {currentLevel > 0 ? (
                    <>
                      <span className="text-4xl md:text-5xl font-black text-pink-500 tracking-tight">
                        {formatHeadlineE2(currentLevel)}
                      </span>
                      <span className="text-sm md:text-base font-bold text-pink-300 mb-1">pg/mL</span>
                    </>
                  ) : (
                    <span className="text-4xl md:text-5xl font-black text-gray-300 tracking-tight">
                      --
                    </span>
                  )}
                </div>
                {/* 95% CI from personal model */}
                {currentCI && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold text-pink-300 uppercase tracking-wide">95% CI</span>
                    <span className="text-[11px] font-semibold text-pink-400">
                      {currentCI.lo.toFixed(0)} – {currentCI.hi.toFixed(0)}
                      <span className="text-[9px] font-normal text-pink-300 ml-0.5">pg/mL</span>
                    </span>
                  </div>
                )}
                {personalLevel !== null && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold text-rose-300 uppercase tracking-wide">
                      {t('chart.personal_model')}
                    </span>
                    <span className="text-[10px] font-semibold text-rose-500">
                      {personalLevel.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {hasPersonalModel && rawLevel > 0 && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Raw</span>
                    <span className="text-[10px] font-semibold text-gray-500">
                      {rawLevel.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {!hasDoseHistory && baselineLevel !== null && (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[9px] font-bold text-teal-400 uppercase tracking-wide">Baseline</span>
                    <span className="text-[10px] font-semibold text-teal-500">
                      {baselineLevel.toFixed(1)} pg/mL
                    </span>
                  </div>
                )}
                {currentStatus && (
                  <div className={`px-2.5 py-1 rounded-lg border ${currentStatus.bg} ${currentStatus.border} flex items-center gap-1.5 mt-1 w-fit`}>
                    <Info size={10} className={currentStatus.color} />
                    <span className={`text-[9px] md:text-[10px] font-bold ${currentStatus.color}`}>
                      {t(currentStatus.label)}
                    </span>
                  </div>
                )}
              </div>

              {/* CPA Display */}
              <div className="space-y-1">
                <div className="text-[10px] md:text-xs font-bold text-purple-400 uppercase tracking-wider">
                  CPA
                </div>
                <div className="flex items-end gap-2">
                  {currentCPA > 0 ? (
                    <>
                      <span className="text-4xl md:text-5xl font-black text-purple-600 tracking-tight">
                        {formatHeadlineCPA(currentCPA)}
                      </span>
                      <span className="text-sm md:text-base font-bold text-purple-300 mb-1">ng/mL</span>
                    </>
                  ) : (
                    <span className="text-4xl md:text-5xl font-black text-gray-300 tracking-tight">
                      --
                    </span>
                  )}
                </div>
                {hasPersonalCpaModel && currentCPA > 0 && (
                  <>
                    {currentCPACI && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-bold text-purple-300 uppercase tracking-wide">{t('chart.cpa_pop_range')}</span>
                        <span className="text-[11px] font-semibold text-purple-400">
                          {currentCPACI.lo.toFixed(2)} – {currentCPACI.hi.toFixed(2)}
                          <span className="text-[9px] font-normal text-purple-300 ml-0.5">ng/mL</span>
                        </span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[9px] font-bold text-purple-300 uppercase tracking-wide">
                        {t('chart.cpa_adherence')}
                      </span>
                      {personalCPA !== null && (
                        <span className="text-[10px] font-semibold text-purple-500">
                          {personalCPA.toFixed(2)} ng/mL
                        </span>
                      )}
                    </div>
                    {rawCPA > 0 && rawCPA !== personalCPA && (
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">Base</span>
                        <span className="text-[10px] font-semibold text-gray-500">
                          {rawCPA.toFixed(2)} ng/mL
                        </span>
                      </div>
                    )}
                  </>
                )}
                {currentCPA > 0 && (
                  <div className="mt-1 text-[9px] text-gray-400 leading-tight italic">
                    {t('chart.cpa_note')}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
            <div className="flex items-center gap-3 p-4 rounded-2xl bg-white border border-gray-200 shadow-sm">
              <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-200">
                <Activity size={18} className="text-gray-600" />
              </div>
              <div className="leading-tight">
                <p className="text-[11px] md:text-xs font-semibold text-gray-500">{t('timeline.title')}</p>
                <p className="text-lg md:text-xl font-bold text-gray-900">{events.length || 0}</p>
              </div>
            </div>
            <button
              onClick={onOpenWeightModal}
              className="flex items-center gap-3 p-4 rounded-2xl bg-white border border-gray-200 shadow-sm hover:border-gray-300 transition text-left"
            >
              <div className="w-12 h-12 rounded-xl bg-gray-50 flex items-center justify-center border border-gray-200">
                <Settings size={18} className="text-gray-700" />
              </div>
              <div className="leading-tight">
                <p className="text-[11px] md:text-xs font-semibold text-gray-500">{t('status.weight')}</p>
                <p className="text-lg md:text-xl font-bold text-gray-900">{weight} kg</p>
              </div>
            </button>
          </div>
        </div>
      </header>

      <main className="bg-white w-full px-4 py-6">
        <ResultChart
          sim={simulation}
          events={events}
          onPointClick={onEditEvent}
          labResults={labResults}
          simCI={simCI}
        />
      </main>
    </>
  );
};

export default OverviewView;
