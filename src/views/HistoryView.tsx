import React, { useMemo } from 'react';
import { Activity, Plus, Layers } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { formatDate, formatTime, getRouteIcon } from '../utils/helpers';
import { DoseEvent, Route as RouteEnum, Ester, ExtraKey, getToE2Factor, isAntiandrogen } from '../../logic';

interface HistoryViewProps {
  events: DoseEvent[];
  onAddEvent: () => void;
  onEditEvent: (event: DoseEvent) => void;
  onBatchAdd: () => void;
}

const HistoryView: React.FC<HistoryViewProps> = ({ events, onAddEvent, onEditEvent, onBatchAdd }) => {
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
        {/* Title and actions share a row while they fit; on narrow phones
            the action buttons wrap below the title rather than breaking
            their labels mid-word. */}
        <div className="w-full p-4 rounded-2xl glass-card glass-highlight relative overflow-hidden flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-3 whitespace-nowrap"
            style={{ color: 'var(--text-primary)' }}>
            <Activity size={22} className="shrink-0" style={{ color: 'var(--accent-300)' }} /> {t('timeline.title')}
          </h2>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <button
              onClick={onBatchAdd}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 h-11 rounded-xl text-sm font-bold whitespace-nowrap btn-press-glass transition"
              style={{ background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border-primary)' }}
            >
              <Layers size={15} />
              <span>{t('batch.title')}</span>
            </button>
            <button
              onClick={onAddEvent}
              className="inline-flex md:hidden items-center justify-center gap-2 px-3.5 py-2 h-11 rounded-xl text-white text-sm font-bold whitespace-nowrap btn-press-glass transition glass-btn-primary"
            >
              <Plus size={16} />
              <span>{t('btn.add')}</span>
            </button>
          </div>
        </div>
      </div>

      {Object.keys(groupedEvents).length === 0 && (
        <div className="mx-4 text-center py-12 rounded-3xl border border-dashed"
          style={{ color: 'var(--text-tertiary)', background: 'var(--bg-card)', borderColor: 'var(--border-primary)' }}>
          <p>{t('timeline.empty')}</p>
        </div>
      )}

      {Object.entries(groupedEvents).map(([date, items]) => (
        <div key={date} className="relative mx-4 rounded-2xl glass-card overflow-hidden">
          <div className="sticky top-0 py-3 px-4 z-0 flex items-center gap-2 border-b glass"
            style={{ borderColor: 'var(--border-secondary)' }}>
            <div className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-300)' }}></div>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>{date}</span>
          </div>
          <div className="divide-y" style={{ divideColor: 'var(--border-secondary)' }}>
            {(items as DoseEvent[]).map(ev => (
              <div
                key={ev.id}
                onClick={() => onEditEvent(ev)}
                className="p-4 flex items-center gap-4 transition-all cursor-pointer group relative btn-press-glass"
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 border`}
                  style={{
                    background: ev.route === RouteEnum.injection ? 'var(--accent-50)' : 'var(--bg-card-hover)',
                    borderColor: ev.route === RouteEnum.injection ? 'var(--accent-200)' : 'var(--border-primary)',
                  }}>
                  {getRouteIcon(ev.route)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                      {ev.route === RouteEnum.patchRemove ? t('route.patchRemove') : t(`ester.${ev.ester}`)}
                    </span>
                    <span className="font-mono text-[11px] font-medium px-2 py-1 rounded-md border"
                      style={{ color: 'var(--text-secondary)', background: 'var(--bg-card-hover)', borderColor: 'var(--border-secondary)' }}>
                      {formatTime(new Date(ev.timeH * 3600000))}
                    </span>
                  </div>
                  <div className="text-xs font-medium space-y-1" style={{ color: 'var(--text-secondary)' }}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="truncate">{t(`route.${ev.route}`)}</span>
                      {ev.extras[ExtraKey.releaseRateUGPerDay] && (
                        <>
                          <span style={{ color: 'var(--text-tertiary)' }}>•</span>
                          <span style={{ color: 'var(--text-primary)' }}>{`${ev.extras[ExtraKey.releaseRateUGPerDay]} µg/d`}</span>
                        </>
                      )}
                      <span className="text-[11px] font-mono font-semibold px-1.5 py-0.5 rounded border ml-auto" style={{ color: 'var(--text-secondary)', background: 'var(--bg-card-hover)', borderColor: 'var(--border-secondary)' }}>
                        {`${ev.weightKG} ${t('field.weight_unit')}`}
                      </span>
                    </div>
                    {ev.route !== RouteEnum.patchRemove && !ev.extras[ExtraKey.releaseRateUGPerDay] && (
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1" style={{ color: 'var(--text-primary)' }}>
                        <span>{`${t('timeline.dose_label')}: ${ev.doseMG.toFixed(2)} mg`}</span>
                        {ev.ester !== Ester.E2 && !isAntiandrogen(ev.ester) && (
                          <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
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
