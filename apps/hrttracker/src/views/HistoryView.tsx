import React, { useMemo } from 'react';
import { Activity, Plus } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { formatDate, formatTime, getRouteIcon } from '../utils/helpers';
import { DoseEvent, Route as RouteEnum, Ester, ExtraKey, getToE2Factor } from '../../logic';

interface HistoryViewProps {
  events: DoseEvent[];
  onAddEvent: () => void;
  onEditEvent: (event: DoseEvent) => void;
}

const HistoryView: React.FC<HistoryViewProps> = ({ events, onAddEvent, onEditEvent }) => {
  const { t, lang } = useTranslation();

  const groupedEvents = useMemo(() => {
    const sorted = [...events].sort((a, b) => b.timeH - a.timeH);
    const groups: Record<string, DoseEvent[]> = {};
    sorted.forEach(e => {
      const d = formatDate(new Date(e.timeH * 3600000), lang);
      if (!groups[d]) groups[d] = [];
      groups[d].push(e);
    });
    return groups;
  }, [events, lang]);

  return (
    <div className="relative space-y-5 pt-6 pb-16">
      <div className="px-4">
        <div className="w-full p-4 rounded-2xl bg-white flex items-center justify-between shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight flex items-center gap-3">
            <Activity size={22} className="text-[#f6c4d7]" /> {t('timeline.title')}
          </h2>
          <button
            onClick={onAddEvent}
            className="inline-flex md:hidden items-center justify-center gap-2 px-3.5 py-2 h-11 rounded-xl bg-gray-900 text-white text-sm font-bold shadow-sm hover:shadow-md transition"
          >
            <Plus size={16} />
            <span>{t('btn.add')}</span>
          </button>
        </div>
      </div>

      {Object.keys(groupedEvents).length === 0 && (
        <div className="mx-4 text-center py-12 text-gray-400 bg-white rounded-3xl border border-dashed border-gray-200 shadow-sm">
          <p>{t('timeline.empty')}</p>
        </div>
      )}

      {Object.entries(groupedEvents).map(([date, items]) => (
        <div key={date} className="relative mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="sticky top-0 bg-white/95 backdrop-blur py-3 px-4 z-0 flex items-center gap-2 border-b border-gray-100">
            <div className="w-2 h-2 rounded-full bg-pink-200"></div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{date}</span>
          </div>
          <div className="divide-y divide-gray-100">
            {(items as DoseEvent[]).map(ev => (
              <div
                key={ev.id}
                onClick={() => onEditEvent(ev)}
                className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-all cursor-pointer group relative"
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${ev.route === RouteEnum.injection ? 'bg-pink-50' : 'bg-gray-50'} border border-gray-100`}>
                  {getRouteIcon(ev.route)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-gray-900 text-sm truncate">
                      {ev.route === RouteEnum.patchRemove ? t('route.patchRemove') : t(`ester.${ev.ester}`)}
                    </span>
                    <span className="font-mono text-[11px] font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                      {formatTime(new Date(ev.timeH * 3600000))}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 font-medium space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate">{t(`route.${ev.route}`)}</span>
                      {ev.extras[ExtraKey.releaseRateUGPerDay] && (
                        <>
                          <span className="text-gray-300">•</span>
                          <span className="text-gray-700">{`${ev.extras[ExtraKey.releaseRateUGPerDay]} µg/d`}</span>
                        </>
                      )}
                    </div>
                    {ev.route !== RouteEnum.patchRemove && !ev.extras[ExtraKey.releaseRateUGPerDay] && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-700">
                        <span>{`${t('timeline.dose_label')}: ${ev.doseMG.toFixed(2)} mg`}</span>
                        {ev.ester !== Ester.E2 && ev.ester !== Ester.CPA && (
                          <span className="text-gray-500 text-[11px]">
                            {`(${ (ev.doseMG * getToE2Factor(ev.ester)).toFixed(2) } mg E2)`}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

export default HistoryView;
