import React, { useState, useMemo } from 'react';
import { AlertTriangle, Monitor, Cloud, ChevronDown, ChevronUp, Check, Plus, Minus, Pencil } from 'lucide-react';
import Modal from './ui/Modal';
import { useTranslation } from '../contexts/LanguageContext';

export interface FieldDiff {
  field: string;
  localValue: any;
  cloudValue: any;
}

export interface ConflictState {
  localData: Record<string, any>;
  cloudData: Record<string, any>;
  diffs: FieldDiff[];
  localTime: string;
  cloudTime: string;
}

interface SyncConflictModalProps {
  isOpen: boolean;
  conflict: ConflictState | null;
  onResolve: (resolution: 'local' | 'cloud' | 'merge', mergedData?: Record<string, any>) => void;
}

const FIELD_KEYS: Record<string, string> = {
  events: 'sync.conflict.field.events',
  weight: 'sync.conflict.field.weight',
  labResults: 'sync.conflict.field.labResults',
  lang: 'sync.conflict.field.lang',
  calibrationModel: 'sync.conflict.field.calibrationModel',
  calibrationMode: 'sync.conflict.field.calibrationMode',
  themeColor: 'sync.conflict.field.theme',
  themeMode: 'settings.theme.mode',
  darkMode: 'sync.conflict.field.darkMode',
  applyE2LearningToCPA: 'sync.conflict.field.applyE2LearningToCPA',
  applyCPAInhibitionToE2: 'sync.conflict.field.applyCPAInhibitionToE2',
  gelProducts: 'sync.conflict.field.gelProducts',
};

const LANG_NAMES: Record<string, string> = {
  zh: '简体中文',
  'zh-TW': '繁體中文',
  en: 'English',
  ja: '日本語',
};

const CALIBRATION_NAMES: Record<string, string> = {
  ekf: 'EKF',
  'ou-kalman': 'OU-Kalman',
  'hybrid-mipd': 'Hybrid-MIPD',
};

const CALIBRATION_MODE_NAMES: Record<string, string> = {
  causal: 'sync.conflict.mode.causal',
  retrospective: 'sync.conflict.mode.retrospective',
};

// ─── Array diff helpers ───

interface DoseEvent {
  id: string;
  route: string;
  timeH: number;
  doseMG: number;
  ester: string;
  extras?: Record<string, number>;
}

interface LabResult {
  id: string;
  timeH: number;
  concValue: number;
  unit: string;
}

type ArrayDiffItem<T> = { type: 'added' | 'removed' | 'modified'; local?: T; cloud?: T };

function diffById<T extends { id: string }>(localArr: T[], cloudArr: T[]): ArrayDiffItem<T>[] {
  const localMap = new Map(localArr.map(e => [e.id, e]));
  const cloudMap = new Map(cloudArr.map(e => [e.id, e]));
  const result: ArrayDiffItem<T>[] = [];

  // Items only in local (removed from cloud / added locally)
  for (const [id, item] of localMap) {
    if (!cloudMap.has(id)) {
      result.push({ type: 'added', local: item });
    }
  }

  // Items only in cloud (removed locally / added from cloud)
  for (const [id, item] of cloudMap) {
    if (!localMap.has(id)) {
      result.push({ type: 'removed', cloud: item });
    }
  }

  // Items in both but different
  for (const [id, localItem] of localMap) {
    const cloudItem = cloudMap.get(id);
    if (cloudItem && JSON.stringify(localItem) !== JSON.stringify(cloudItem)) {
      result.push({ type: 'modified', local: localItem, cloud: cloudItem });
    }
  }

  return result;
}

function formatEventTime(timeH: number): string {
  try {
    const d = new Date(timeH * 3600000);
    return d.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

// ─── Simple field formatter ───

function formatFieldValue(field: string, value: any, t: (k: string) => string): string {
  if (value === undefined || value === null) return '—';
  switch (field) {
    case 'events':
      return Array.isArray(value) ? `${value.length} ${t('sync.conflict.items')}` : '—';
    case 'labResults':
    case 'gelProducts':
      return Array.isArray(value) ? `${value.length} ${t('sync.conflict.items')}` : '—';
    case 'weight':
      return `${value} kg`;
    case 'lang':
      return LANG_NAMES[value] || value;
    case 'calibrationModel':
      return CALIBRATION_NAMES[value] || value;
    case 'calibrationMode': {
      const key = CALIBRATION_MODE_NAMES[value];
      return key ? t(key) : String(value);
    }
    case 'themeColor':
      return value;
    case 'themeMode':
      return t(`settings.theme.${value}`);
    case 'darkMode':
    case 'applyE2LearningToCPA':
    case 'applyCPAInhibitionToE2':
      return value ? t('sync.conflict.on') : t('sync.conflict.off');
    default:
      return String(value);
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ─── Sub-components for detailed array diffs ───

const DiffBadge: React.FC<{ type: 'added' | 'removed' | 'modified' }> = ({ type }) => {
  const map = {
    added:    { icon: Plus, color: '#22c55e', bg: 'color-mix(in srgb, #22c55e 10%, transparent)' },
    removed:  { icon: Minus, color: '#ef4444', bg: 'color-mix(in srgb, #ef4444 10%, transparent)' },
    modified: { icon: Pencil, color: '#f59e0b', bg: 'color-mix(in srgb, #f59e0b 10%, transparent)' },
  };
  const { icon: Icon, color, bg } = map[type];
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded-md shrink-0"
      style={{ background: bg, color }}
    >
      <Icon size={11} strokeWidth={2.5} />
    </span>
  );
};

const EventDiffDetail: React.FC<{ diff: ArrayDiffItem<DoseEvent>[]; t: (k: string) => string }> = ({ diff, t }) => {
  if (diff.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-1.5">
      {diff.map((d, i) => {
        const ev = d.local || d.cloud!;
        const route = t(`route.${ev.route}`) || ev.route;
        const ester = t(`ester.${ev.ester}`) || ev.ester;
        const time = formatEventTime(ev.timeH);
        const dose = `${ev.doseMG} mg`;

        if (d.type === 'modified') {
          const localEv = d.local!;
          const cloudEv = d.cloud!;
          // Show what changed
          const changes: string[] = [];
          if (localEv.doseMG !== cloudEv.doseMG) changes.push(`${localEv.doseMG}→${cloudEv.doseMG} mg`);
          if (localEv.timeH !== cloudEv.timeH) changes.push(`${formatEventTime(localEv.timeH)}→${formatEventTime(cloudEv.timeH)}`);
          if (localEv.route !== cloudEv.route) changes.push(`${t(`route.${localEv.route}`)}→${t(`route.${cloudEv.route}`)}`);
          if (localEv.ester !== cloudEv.ester) changes.push(`${t(`ester.${localEv.ester}`)}→${t(`ester.${cloudEv.ester}`)}`);
          return (
            <div key={i} className="flex items-start gap-2 text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              <DiffBadge type="modified" />
              <div>
                <span className="font-semibold">{ester}</span>
                <span className="mx-1">·</span>
                <span>{time}</span>
                <div className="text-[10px] mt-0.5" style={{ color: '#f59e0b' }}>
                  {changes.join(' , ')}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <DiffBadge type={d.type} />
            <span className="font-semibold">{ester}</span>
            <span>{dose}</span>
            <span className="mx-0.5">·</span>
            <span>{route}</span>
            <span className="mx-0.5">·</span>
            <span>{time}</span>
          </div>
        );
      })}
    </div>
  );
};

const LabDiffDetail: React.FC<{ diff: ArrayDiffItem<LabResult>[]; t: (k: string) => string }> = ({ diff, t }) => {
  if (diff.length === 0) return null;
  return (
    <div className="space-y-1.5 mt-1.5">
      {diff.map((d, i) => {
        const lab = d.local || d.cloud!;
        const time = formatEventTime(lab.timeH);
        const val = `${lab.concValue} ${lab.unit}`;

        if (d.type === 'modified') {
          const l = d.local!;
          const c = d.cloud!;
          const changes: string[] = [];
          if (l.concValue !== c.concValue || l.unit !== c.unit) changes.push(`${l.concValue} ${l.unit}→${c.concValue} ${c.unit}`);
          if (l.timeH !== c.timeH) changes.push(`${formatEventTime(l.timeH)}→${formatEventTime(c.timeH)}`);
          return (
            <div key={i} className="flex items-start gap-2 text-[11px] leading-snug" style={{ color: 'var(--text-secondary)' }}>
              <DiffBadge type="modified" />
              <div>
                <span>{time}</span>
                <span className="mx-1">·</span>
                <span className="font-semibold">{val}</span>
                <div className="text-[10px] mt-0.5" style={{ color: '#f59e0b' }}>
                  {changes.join(' , ')}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <DiffBadge type={d.type} />
            <span>{time}</span>
            <span className="mx-0.5">·</span>
            <span className="font-semibold">{val}</span>
          </div>
        );
      })}
    </div>
  );
};

// ─── Main component ───

const SyncConflictModal: React.FC<SyncConflictModalProps> = ({ isOpen, conflict, onResolve }) => {
  const { t } = useTranslation();
  const [showMerge, setShowMerge] = useState(false);
  const [mergeChoices, setMergeChoices] = useState<Record<string, 'local' | 'cloud'>>({});

  // Compute detailed array diffs
  const eventDiff = useMemo(() => {
    if (!conflict) return [];
    const evDiff = conflict.diffs.find(d => d.field === 'events');
    if (!evDiff) return [];
    return diffById<DoseEvent>(evDiff.localValue || [], evDiff.cloudValue || []);
  }, [conflict]);

  const labDiff = useMemo(() => {
    if (!conflict) return [];
    const lDiff = conflict.diffs.find(d => d.field === 'labResults');
    if (!lDiff) return [];
    return diffById<LabResult>(lDiff.localValue || [], lDiff.cloudValue || []);
  }, [conflict]);

  React.useEffect(() => {
    if (conflict) {
      const initial: Record<string, 'local' | 'cloud'> = {};
      conflict.diffs.forEach((d) => {
        const localNewer = new Date(conflict.localTime) > new Date(conflict.cloudTime);
        initial[d.field] = localNewer ? 'local' : 'cloud';
      });
      setMergeChoices(initial);
      setShowMerge(false);
    }
  }, [conflict]);

  const mergedData = useMemo(() => {
    if (!conflict) return {};
    const result: Record<string, any> = { ...conflict.cloudData };
    conflict.diffs.forEach((d) => {
      const choice = mergeChoices[d.field] || 'cloud';
      result[d.field] = choice === 'local' ? d.localValue : d.cloudValue;
    });
    Object.keys(conflict.localData).forEach((key) => {
      if (!(key in result) && key !== 'dataHash' && key !== 'lastModified' && key !== 'lastDataUpdated') {
        result[key] = conflict.localData[key];
      }
    });
    return result;
  }, [conflict, mergeChoices]);

  if (!conflict) return null;

  const handleMergeChoice = (field: string, choice: 'local' | 'cloud') => {
    setMergeChoices((prev) => ({ ...prev, [field]: choice }));
  };

  // Separate array diffs from simple diffs for rendering
  const arrayFields = new Set(['events', 'labResults']);
  const simpleDiffs = conflict.diffs.filter(d => !arrayFields.has(d.field));
  const eventFieldDiff = conflict.diffs.find(d => d.field === 'events');
  const labFieldDiff = conflict.diffs.find(d => d.field === 'labResults');

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {}}
      title={t('sync.conflict.title')}
      maxWidth="max-w-xl"
      hideClose
    >
      <div className="space-y-4">
        {/* Warning banner */}
        <div
          className="flex items-start gap-3 p-3 rounded-xl"
          style={{
            background: 'color-mix(in srgb, var(--accent-50) 60%, transparent)',
            border: '1px solid var(--accent-200)',
          }}
        >
          <AlertTriangle size={20} className="shrink-0 mt-0.5" style={{ color: 'var(--accent-500)' }} />
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t('sync.conflict.desc')}
          </p>
        </div>

        {/* Time comparison */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className="p-3 rounded-xl text-center"
            style={{
              background: 'color-mix(in srgb, #3b82f6 8%, var(--bg-card-hover))',
              border: '1px solid color-mix(in srgb, #3b82f6 20%, var(--border-secondary))',
            }}
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Monitor size={14} className="text-blue-500" />
              <span className="text-xs font-bold text-blue-500">{t('sync.conflict.local')}</span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatTime(conflict.localTime)}
            </span>
          </div>
          <div
            className="p-3 rounded-xl text-center"
            style={{
              background: 'color-mix(in srgb, #8b5cf6 8%, var(--bg-card-hover))',
              border: '1px solid color-mix(in srgb, #8b5cf6 20%, var(--border-secondary))',
            }}
          >
            <div className="flex items-center justify-center gap-1.5 mb-1">
              <Cloud size={14} className="text-purple-500" />
              <span className="text-xs font-bold text-purple-500">{t('sync.conflict.cloud')}</span>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              {formatTime(conflict.cloudTime)}
            </span>
          </div>
        </div>

        {/* ── Detailed events diff ── */}
        {eventFieldDiff && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-primary)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-2 text-xs font-bold"
              style={{ background: 'var(--bg-card-hover)', borderBottom: '1px solid var(--border-secondary)' }}
            >
              <span style={{ color: 'var(--text-primary)' }}>{t('sync.conflict.field.events')}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {t('sync.conflict.local')} {(eventFieldDiff.localValue || []).length} {t('sync.conflict.items')}
                {' / '}
                {t('sync.conflict.cloud')} {(eventFieldDiff.cloudValue || []).length} {t('sync.conflict.items')}
              </span>
            </div>
            <div className="px-3 py-2" style={{ maxHeight: '180px', overflowY: 'auto' }}>
              {eventDiff.length > 0 ? (
                <EventDiffDetail diff={eventDiff} t={t} />
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {t('sync.conflict.order_only')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Detailed lab results diff ── */}
        {labFieldDiff && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-primary)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-2 text-xs font-bold"
              style={{ background: 'var(--bg-card-hover)', borderBottom: '1px solid var(--border-secondary)' }}
            >
              <span style={{ color: 'var(--text-primary)' }}>{t('sync.conflict.field.labResults')}</span>
              <span style={{ color: 'var(--text-tertiary)' }}>
                {t('sync.conflict.local')} {(labFieldDiff.localValue || []).length} {t('sync.conflict.items')}
                {' / '}
                {t('sync.conflict.cloud')} {(labFieldDiff.cloudValue || []).length} {t('sync.conflict.items')}
              </span>
            </div>
            <div className="px-3 py-2" style={{ maxHeight: '140px', overflowY: 'auto' }}>
              {labDiff.length > 0 ? (
                <LabDiffDetail diff={labDiff} t={t} />
              ) : (
                <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                  {t('sync.conflict.order_only')}
                </span>
              )}
            </div>
          </div>
        )}

        {/* ── Simple fields diff table ── */}
        {simpleDiffs.length > 0 && (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border-primary)' }}
          >
            <div
              className="grid grid-cols-[1fr_1fr_1fr] text-xs font-bold px-3 py-2"
              style={{
                background: 'var(--bg-card-hover)',
                color: 'var(--text-tertiary)',
                borderBottom: '1px solid var(--border-secondary)',
              }}
            >
              <span></span>
              <span className="text-center text-blue-500">{t('sync.conflict.local')}</span>
              <span className="text-center text-purple-500">{t('sync.conflict.cloud')}</span>
            </div>
            {simpleDiffs.map((diff, idx) => (
              <div
                key={diff.field}
                className="grid grid-cols-[1fr_1fr_1fr] text-xs px-3 py-2.5 items-center"
                style={{
                  borderBottom: idx < simpleDiffs.length - 1 ? '1px solid var(--border-secondary)' : undefined,
                }}
              >
                <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {t(FIELD_KEYS[diff.field] || diff.field)}
                </span>
                <span
                  className="text-center px-2 py-1 rounded-lg truncate"
                  style={{ background: 'color-mix(in srgb, #3b82f6 6%, transparent)', color: 'var(--text-secondary)' }}
                  title={formatFieldValue(diff.field, diff.localValue, t)}
                >
                  {formatFieldValue(diff.field, diff.localValue, t)}
                </span>
                <span
                  className="text-center px-2 py-1 rounded-lg truncate"
                  style={{ background: 'color-mix(in srgb, #8b5cf6 6%, transparent)', color: 'var(--text-secondary)' }}
                  title={formatFieldValue(diff.field, diff.cloudValue, t)}
                >
                  {formatFieldValue(diff.field, diff.cloudValue, t)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Quick action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => onResolve('local')}
            className="btn-press-glass py-3 px-4 rounded-xl font-bold text-sm transition-all"
            style={{
              background: 'color-mix(in srgb, #3b82f6 10%, var(--bg-card-hover))',
              border: '1px solid color-mix(in srgb, #3b82f6 30%, var(--border-primary))',
              color: '#3b82f6',
            }}
          >
            <Monitor size={16} className="inline mr-1.5 -mt-0.5" />
            {t('sync.conflict.use_local')}
          </button>
          <button
            onClick={() => onResolve('cloud')}
            className="btn-press-glass py-3 px-4 rounded-xl font-bold text-sm transition-all"
            style={{
              background: 'color-mix(in srgb, #8b5cf6 10%, var(--bg-card-hover))',
              border: '1px solid color-mix(in srgb, #8b5cf6 30%, var(--border-primary))',
              color: '#8b5cf6',
            }}
          >
            <Cloud size={16} className="inline mr-1.5 -mt-0.5" />
            {t('sync.conflict.use_cloud')}
          </button>
        </div>

        {/* Manual merge toggle */}
        <button
          onClick={() => setShowMerge(!showMerge)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all"
          style={{
            background: 'var(--bg-card-hover)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-secondary)',
          }}
        >
          {showMerge ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {t('sync.conflict.manual_merge')}
        </button>

        {/* Manual merge panel */}
        {showMerge && (
          <div
            className="rounded-xl p-4 space-y-3"
            style={{
              background: 'var(--bg-card-hover)',
              border: '1px solid var(--border-primary)',
            }}
          >
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {t('sync.conflict.merge_select')}
            </p>
            {conflict.diffs.map((diff) => {
              const isArray = arrayFields.has(diff.field);
              return (
                <div key={diff.field} className="space-y-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {t(FIELD_KEYS[diff.field] || diff.field)}
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {/* Local option */}
                    <button
                      onClick={() => handleMergeChoice(diff.field, 'local')}
                      className="relative p-2.5 rounded-xl text-xs text-left transition-all"
                      style={{
                        background: mergeChoices[diff.field] === 'local'
                          ? 'color-mix(in srgb, #3b82f6 12%, var(--bg-card))'
                          : 'var(--bg-card)',
                        border: mergeChoices[diff.field] === 'local'
                          ? '2px solid #3b82f6'
                          : '1px solid var(--border-secondary)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {mergeChoices[diff.field] === 'local' && (
                        <Check size={12} className="absolute top-1.5 right-1.5 text-blue-500" />
                      )}
                      <div className="text-[10px] font-bold text-blue-500 mb-1">
                        {t('sync.conflict.local')}
                        {isArray && <span className="font-normal ml-1">({(diff.localValue || []).length} {t('sync.conflict.items')})</span>}
                      </div>
                      {!isArray && <div className="truncate">{formatFieldValue(diff.field, diff.localValue, t)}</div>}
                    </button>
                    {/* Cloud option */}
                    <button
                      onClick={() => handleMergeChoice(diff.field, 'cloud')}
                      className="relative p-2.5 rounded-xl text-xs text-left transition-all"
                      style={{
                        background: mergeChoices[diff.field] === 'cloud'
                          ? 'color-mix(in srgb, #8b5cf6 12%, var(--bg-card))'
                          : 'var(--bg-card)',
                        border: mergeChoices[diff.field] === 'cloud'
                          ? '2px solid #8b5cf6'
                          : '1px solid var(--border-secondary)',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {mergeChoices[diff.field] === 'cloud' && (
                        <Check size={12} className="absolute top-1.5 right-1.5 text-purple-500" />
                      )}
                      <div className="text-[10px] font-bold text-purple-500 mb-1">
                        {t('sync.conflict.cloud')}
                        {isArray && <span className="font-normal ml-1">({(diff.cloudValue || []).length} {t('sync.conflict.items')})</span>}
                      </div>
                      {!isArray && <div className="truncate">{formatFieldValue(diff.field, diff.cloudValue, t)}</div>}
                    </button>
                  </div>
                </div>
              );
            })}

            <button
              onClick={() => onResolve('merge', mergedData)}
              className="btn-press-glass w-full py-3 rounded-xl font-bold text-sm text-white transition-all"
              style={{
                background: 'linear-gradient(135deg, var(--accent-400) 0%, var(--accent-500) 100%)',
                boxShadow: '0 4px 14px color-mix(in srgb, var(--accent-500) 25%, transparent)',
              }}
            >
              {t('sync.conflict.confirm_merge')}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SyncConflictModal;
