import React, { useState } from 'react';
import { FlaskConical, Plus, Brain, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, Cpu, Waves, Clock, History, Sparkles, Info } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { formatDate, formatTime } from '../utils/helpers';
import { LabResult, PersonalModelState, EKFDiagnostics, CalibrationModel, CalibrationMode } from '../../logic';

interface LabViewProps {
  labResults: LabResult[];
  personalModel: PersonalModelState | null;
  lastDiagnostics: EKFDiagnostics | null;
  applyE2LearningToCPA: boolean;
  onSetApplyE2LearningToCPA: (enabled: boolean) => void;
  applyCPAInhibitionToE2: boolean;
  onSetApplyCPAInhibitionToE2: (enabled: boolean) => void;
  calibrationModel: CalibrationModel;
  onSetCalibrationModel: (model: CalibrationModel) => void;
  calibrationMode: CalibrationMode;
  onSetCalibrationMode: (mode: CalibrationMode) => void;
  onAddLabResult: () => void;
  onEditLabResult: (result: LabResult) => void;
  onClearLabResults: () => void;
}

// Compact progress bar for convergence score
const ConvergenceBar: React.FC<{ score: number }> = ({ score }) => {
  const pct = Math.round(score * 100);
  const color =
    score < 0.2 ? 'bg-gray-300' :
    score < 0.5 ? 'bg-amber-400' :
    score < 0.75 ? 'bg-emerald-400' :
    'bg-emerald-600';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border-secondary)' }}>
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-bold w-8 text-right" style={{ color: 'var(--text-tertiary)' }}>{pct}%</span>
    </div>
  );
};

// One row in the learning panel
const StatRow: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="flex items-start justify-between gap-2 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border-secondary)' }}>
    <div className="min-w-0">
      <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {hint && <p className="text-[10px] mt-0.5 leading-tight" style={{ color: 'var(--text-tertiary)' }}>{hint}</p>}
    </div>
    <div className="text-[11px] font-bold shrink-0" style={{ color: 'var(--text-primary)' }}>{value}</div>
  </div>
);

const LearningPanel: React.FC<{
  personalModel: PersonalModelState | null;
  lastDiagnostics: EKFDiagnostics | null;
  calibrationModel: CalibrationModel;
}> = ({ personalModel, lastDiagnostics, calibrationModel }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  // lastDiagnostics is always produced by the independent EKF update, even
  // when OU / Hybrid-MIPD is the selected calibration model — surface that.
  const isEkfsReference = calibrationModel !== 'ekf';

  const hasModel = personalModel !== null && personalModel.observationCount > 0;
  const conv = lastDiagnostics?.convergenceScore ?? 0;

  const convLabel =
    conv < 0.15 ? t('lab.learning_conv_none') :
    conv < 0.6  ? t('lab.learning_conv_partial') :
    t('lab.learning_conv_good');

  const ampFactor = lastDiagnostics?.thetaS ?? (hasModel ? Math.exp(personalModel!.thetaMean[0]) : null);
  const clrFactor = lastDiagnostics?.thetaK ?? (hasModel ? Math.exp(personalModel!.thetaMean[1]) : null);

  return (
    <div className="mx-4 glass-card overflow-hidden"
      style={{ borderColor: 'var(--accent-200)' }}>
      {/* Non-alarming notice: the EKF diagnostics below are an independent
          reference when a non-EKF calibration model is selected */}
      {isEkfsReference && (
        <div className="px-4 pt-3">
          <div className="flex items-start gap-2 rounded-xl px-3 py-2" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <Info size={13} className="text-blue-500 mt-px shrink-0" />
            <p className="text-[10px] font-medium leading-relaxed text-blue-600 dark:text-blue-400">{t('lab.learning.ekf_reference')}</p>
          </div>
        </div>
      )}
      {/* Header – always visible */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ }}
        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-50)', border: '1px solid var(--accent-100)' }}>
            <Brain size={15} style={{ color: 'var(--accent-400)' }} />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('lab.learning_title')}</p>
            {hasModel ? (
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                {personalModel!.observationCount} {t('lab.learning_obs')}
                {lastDiagnostics?.isOutlier && (
                  <span className="ml-2 text-amber-500 font-semibold">⚠</span>
                )}
              </p>
            ) : (
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{t('lab.learning_conv_none')}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasModel && (
            <div className="w-20">
              <ConvergenceBar score={conv} />
            </div>
          )}
          {expanded ? <ChevronUp size={14} style={{ color: 'var(--text-tertiary)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />}
        </div>
      </button>

      {/* Expanded detail section */}
      {expanded && (
        <div className="border-t px-4 py-3 space-y-1" style={{ borderColor: 'var(--border-secondary)' }}>
          {/* Description */}
          <p className="text-[10px] pb-2 leading-relaxed" style={{ color: 'var(--text-tertiary)' }}>{t('lab.learning_desc')}</p>

          {!hasModel ? (
            <p className="text-[11px] text-center py-4 leading-relaxed px-2" style={{ color: 'var(--text-tertiary)' }}>{t('lab.learning_conv_none')}</p>
          ) : (
            <>
              {/* Outlier warning */}
              {lastDiagnostics?.isOutlier && (
                <div className="flex items-start gap-2 rounded-xl px-3 py-2 mb-2" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}>
                  <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">{t('lab.learning_outlier')}</p>
                </div>
              )}

              {/* Parameters */}
              <StatRow
                label={t('lab.learning_amplitude')}
                value={ampFactor !== null ? `×${ampFactor.toFixed(3)}` : '—'}
                hint={t('lab.learning_amplitude_hint')}
              />
              <StatRow
                label={t('lab.learning_clearance')}
                value={clrFactor !== null ? `×${clrFactor.toFixed(3)}` : '—'}
                hint={t('lab.learning_clearance_hint')}
              />

              {/* Convergence */}
              <div className="py-1.5 border-b" style={{ borderColor: 'var(--border-secondary)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
                    {t('lab.learning_convergence')}
                    {isEkfsReference && ' (EKF)'}
                  </span>
                  <span className="text-[10px] font-bold" style={{ color: 'var(--text-secondary)' }}>{convLabel}</span>
                </div>
                <ConvergenceBar score={conv} />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>{t('lab.learning_convergence_tip')}</p>
              </div>

              {/* Last NIS */}
              {lastDiagnostics && (
                <>
                  <StatRow
                    label={t('lab.learning_nis')}
                    value={
                      <span className={lastDiagnostics.isOutlier ? 'text-amber-600' : 'text-emerald-600'}>
                        {lastDiagnostics.NIS.toFixed(2)}
                        {lastDiagnostics.isOutlier ? ' ⚠' : ' ✓'}
                      </span>
                    }
                    hint={t('lab.learning_nis_hint')}
                  />
                  <StatRow
                    label={t('lab.learning_pred')}
                    value={`${lastDiagnostics.predictedPGmL.toFixed(1)} pg/mL`}
                    hint={t('lab.learning_pred_hint')}
                  />
                  <StatRow
                    label={t('lab.learning_obs_val')}
                    value={`${lastDiagnostics.observedPGmL.toFixed(1)} pg/mL`}
                    hint={t('lab.learning_obs_val_hint')}
                  />
                  <StatRow
                    label={t('lab.learning_ci95')}
                    value={`${lastDiagnostics.ci95Low.toFixed(0)} – ${lastDiagnostics.ci95High.toFixed(0)} pg/mL`}
                    hint={t('lab.learning_ci95_hint')}
                  />
                  <StatRow
                    label={t('lab.learning_residual')}
                    value={
                      <span className={lastDiagnostics.residualLog > 0 ? 'text-amber-600' : 'text-blue-600'}>
                        {lastDiagnostics.residualLog > 0 ? '+' : ''}{lastDiagnostics.residualLog.toFixed(3)}
                      </span>
                    }
                    hint={t('lab.learning_residual_hint')}
                  />
                </>
              )}
            </>
          )}

          {/* Reset button removed — model resets automatically when lab results are deleted */}
        </div>
      )}
    </div>
  );
};

// Model option card
const ModelOption: React.FC<{
  icon: React.ReactNode;
  label: string;
  desc: string;
  pros: string[];
  con: string;
  selected: boolean;
  onSelect: () => void;
}> = ({ icon, label, desc, pros, con, selected, onSelect }) => {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-3 rounded-xl border transition-all ${
        selected
          ? 'border-[var(--accent-300)] bg-[var(--accent-50)]'
          : 'border-[var(--border-secondary)] hover:border-[var(--border-primary)]'
      }`}
      style={!selected ? { background: 'var(--bg-secondary)' } : undefined}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
          selected ? 'bg-[var(--accent-100)] border-[var(--accent-200)]' : 'bg-[var(--bg-card)] border-[var(--border-primary)]'
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[13px] font-bold ${selected ? 'text-[var(--accent-600)]' : ''}`} style={!selected ? { color: 'var(--text-primary)' } : undefined}>{label}</span>
            {selected && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[var(--accent-100)] text-[var(--accent-600)] text-[9px] font-bold">
                <CheckCircle2 size={9} />
                {t('lab.model_active')}
              </span>
            )}
          </div>
          <p className="text-[10px] leading-relaxed mb-1.5" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
          <div className="space-y-0.5">
            {pros.map((pro, i) => (
              <p key={i} className="text-[10px] font-medium text-emerald-600 flex items-start gap-1">
                <span className="shrink-0 mt-px">✓</span>
                <span>{pro}</span>
              </p>
            ))}
            <p className="text-[10px] font-medium text-amber-600 flex items-start gap-1">
              <span className="shrink-0 mt-px">✗</span>
              <span>{con}</span>
            </p>
          </div>
        </div>
        <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 flex items-center justify-center ${
          selected ? 'border-[var(--accent-500)] bg-[var(--accent-500)]' : 'border-[var(--border-primary)] bg-[var(--bg-card)]'
        }`}>
          {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
      </div>
    </button>
  );
};

const LabView: React.FC<LabViewProps> = ({
  labResults,
  personalModel,
  lastDiagnostics,
  applyE2LearningToCPA,
  onSetApplyE2LearningToCPA,
  applyCPAInhibitionToE2,
  onSetApplyCPAInhibitionToE2,
  calibrationModel,
  onSetCalibrationModel,
  calibrationMode,
  onSetCalibrationMode,
  onAddLabResult,
  onEditLabResult,
  onClearLabResults,
}) => {
  const { t, lang } = useTranslation();

  return (
    <div className="relative space-y-5 pt-6 pb-8">
      <div className="px-4">
        {/* Title and action share a row while they fit; on narrow phones the
            button wraps below the title rather than breaking mid-word. */}
        <div className="w-full p-4 glass-card flex flex-wrap items-center justify-between gap-x-3 gap-y-3">
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-3 whitespace-nowrap"
            style={{ color: 'var(--text-primary)' }}>
            <FlaskConical size={22} className="shrink-0 text-teal-500" /> {t('lab.title')}
          </h2>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <button
              onClick={onAddLabResult}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 h-11 rounded-xl text-white text-sm font-bold whitespace-nowrap btn-press-glass transition glass-btn-primary"
            >
              <Plus size={16} />
              <span>{t('lab.add_title')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Personal model learning panel */}
      <LearningPanel
        personalModel={personalModel}
        lastDiagnostics={lastDiagnostics}
        calibrationModel={calibrationModel}
      />

      {/* E2 Calibration Model Selector */}
      <div className="mx-4 glass-card p-4 space-y-3">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('lab.model_selector')}</p>
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t('lab.model_selector_desc')}</p>
        </div>
        <div className="space-y-2">
          <ModelOption
            icon={<Cpu size={14} className={calibrationModel === 'ekf' ? 'text-[var(--accent-500)]' : ''} style={calibrationModel !== 'ekf' ? { color: 'var(--text-tertiary)' } : undefined} />}
            label={t('lab.model_ekf_label')}
            desc={t('lab.model_ekf_desc')}
            pros={[t('lab.model_ekf_pro1'), t('lab.model_ekf_pro2')]}
            con={t('lab.model_ekf_con')}
            selected={calibrationModel === 'ekf'}
            onSelect={() => onSetCalibrationModel('ekf')}
          />
          <ModelOption
            icon={<Waves size={14} className={calibrationModel === 'ou-kalman' ? 'text-[var(--accent-500)]' : ''} style={calibrationModel !== 'ou-kalman' ? { color: 'var(--text-tertiary)' } : undefined} />}
            label={t('lab.model_ou_label')}
            desc={t('lab.model_ou_desc')}
            pros={[t('lab.model_ou_pro1'), t('lab.model_ou_pro2')]}
            con={t('lab.model_ou_con')}
            selected={calibrationModel === 'ou-kalman'}
            onSelect={() => onSetCalibrationModel('ou-kalman')}
          />
          <ModelOption
            icon={<Sparkles size={14} className={calibrationModel === 'hybrid-mipd' ? 'text-[var(--accent-500)]' : ''} style={calibrationModel !== 'hybrid-mipd' ? { color: 'var(--text-tertiary)' } : undefined} />}
            label={t('lab.model_mipd_label')}
            desc={t('lab.model_mipd_desc')}
            pros={[t('lab.model_mipd_pro1'), t('lab.model_mipd_pro2')]}
            con={t('lab.model_mipd_con')}
            selected={calibrationModel === 'hybrid-mipd'}
            onSelect={() => onSetCalibrationModel('hybrid-mipd')}
          />
        </div>
      </div>

      {/* Personalized curve temporal mode: causal vs retrospective */}
      <div className="mx-4 glass-card p-4 space-y-3">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('lab.mode_selector')}</p>
          <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{t('lab.mode_selector_desc')}</p>
        </div>
        <div className="space-y-2">
          <ModelOption
            icon={<Clock size={14} className={calibrationMode === 'causal' ? 'text-[var(--accent-500)]' : ''} style={calibrationMode !== 'causal' ? { color: 'var(--text-tertiary)' } : undefined} />}
            label={t('lab.mode_causal_label')}
            desc={t('lab.mode_causal_desc')}
            pros={[t('lab.mode_causal_pro1'), t('lab.mode_causal_pro2')]}
            con={t('lab.mode_causal_con')}
            selected={calibrationMode === 'causal'}
            onSelect={() => onSetCalibrationMode('causal')}
          />
          <ModelOption
            icon={<History size={14} className={calibrationMode === 'retrospective' ? 'text-[var(--accent-500)]' : ''} style={calibrationMode !== 'retrospective' ? { color: 'var(--text-tertiary)' } : undefined} />}
            label={t('lab.mode_retrospective_label')}
            desc={t('lab.mode_retrospective_desc')}
            pros={[t('lab.mode_retrospective_pro1'), t('lab.mode_retrospective_pro2')]}
            con={t('lab.mode_retrospective_con')}
            selected={calibrationMode === 'retrospective'}
            onSelect={() => onSetCalibrationMode('retrospective')}
          />
        </div>
      </div>

      {/* CPA adherence toggle */}
      <div className="mx-4 glass-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('lab.learning_apply_cpa')}</p>
            <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {t('lab.learning_apply_cpa_desc')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={applyE2LearningToCPA}
            onClick={() => onSetApplyE2LearningToCPA(!applyE2LearningToCPA)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
              applyE2LearningToCPA
                ? ''
                : 'bg-gray-200 dark:bg-gray-600 border-gray-200 dark:border-gray-600'
            }`}
            style={applyE2LearningToCPA ? { background: 'var(--accent-500)', borderColor: 'var(--accent-500)' } : undefined}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                applyE2LearningToCPA ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <p className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
          {applyE2LearningToCPA ? t('lab.learning_apply_cpa_on') : t('lab.learning_apply_cpa_off')}
        </p>
      </div>

      {/* CPA→E2 clearance inhibition toggle */}
      <div className="mx-4 glass-card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{t('lab.apply_cpa_inhibition')}</p>
            <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              {t('lab.apply_cpa_inhibition_desc')}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={applyCPAInhibitionToE2}
            onClick={() => onSetApplyCPAInhibitionToE2(!applyCPAInhibitionToE2)}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
              applyCPAInhibitionToE2
                ? ''
                : 'bg-gray-200 dark:bg-gray-600 border-gray-200 dark:border-gray-600'
            }`}
            style={applyCPAInhibitionToE2 ? { background: 'var(--accent-500)', borderColor: 'var(--accent-500)' } : undefined}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                applyCPAInhibitionToE2 ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <p className="mt-2 text-[10px] font-semibold" style={{ color: 'var(--text-tertiary)' }}>
          {applyCPAInhibitionToE2 ? t('lab.apply_cpa_inhibition_on') : t('lab.apply_cpa_inhibition_off')}
        </p>
      </div>

      {labResults.length === 0 ? (
        <div className="mx-4 text-center py-12 glass-card rounded-3xl border-dashed" style={{ color: 'var(--text-tertiary)' }}>
          <p>{t('lab.empty')}</p>
        </div>
      ) : (
        <div className="mx-4 glass-card divide-y divide-[var(--border-secondary)] overflow-hidden">
          {labResults
            .slice()
            .sort((a, b) => b.timeH - a.timeH)
            .map(res => {
              const d = new Date(res.timeH * 3600000);
              return (
                <div
                  key={res.id}
                  className="p-4 flex items-center gap-4 transition-all cursor-pointer group relative"
                  style={{}}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  onClick={() => onEditLabResult(res)}
                >
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: 'var(--accent-50)', border: '1px solid var(--accent-100)' }}>
                    <FlaskConical style={{ color: 'var(--accent-500)' }} size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-sm truncate" style={{ color: 'var(--text-primary)' }}>
                        {res.concValue} {res.unit}
                      </span>
                      <span className="font-mono text-[11px] font-medium bg-[var(--bg-secondary)] px-2 py-1 rounded-md border border-[var(--border-secondary)]">
                        {formatTime(d)}
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                      {formatDate(d, lang)}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <div className="mx-4 glass-card flex items-center justify-end px-4 py-3">
        <button
          onClick={onClearLabResults}
          disabled={!labResults.length}
          className={`px-3 py-2 rounded-lg text-xs font-bold transition ${
            labResults.length ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30' : 'cursor-not-allowed'
          }`}
          style={!labResults.length ? { color: 'var(--text-tertiary)' } : undefined}
        >
          {t('lab.clear_all')}
        </button>
      </div>
    </div>
  );
};

export default LabView;
