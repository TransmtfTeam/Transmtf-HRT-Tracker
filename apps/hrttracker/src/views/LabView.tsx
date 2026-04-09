import React, { useState } from 'react';
import { FlaskConical, Plus, Brain, AlertTriangle, ChevronDown, ChevronUp, CheckCircle2, Cpu, Waves } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { formatDate, formatTime } from '../utils/helpers';
import { LabResult, PersonalModelState, EKFDiagnostics, CalibrationModel } from '../../logic';

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
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] font-bold text-gray-500 w-8 text-right">{pct}%</span>
    </div>
  );
};

// One row in the learning panel
const StatRow: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="flex items-start justify-between gap-2 py-1.5 border-b border-gray-50 last:border-0">
    <div className="min-w-0">
      <span className="text-[11px] font-semibold text-gray-500">{label}</span>
      {hint && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{hint}</p>}
    </div>
    <div className="text-[11px] font-bold text-gray-800 shrink-0">{value}</div>
  </div>
);

const LearningPanel: React.FC<{
  personalModel: PersonalModelState | null;
  lastDiagnostics: EKFDiagnostics | null;
}> = ({ personalModel, lastDiagnostics }) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const hasModel = personalModel !== null && personalModel.observationCount > 0;
  const conv = lastDiagnostics?.convergenceScore ?? 0;

  const convLabel =
    conv < 0.15 ? t('lab.learning_conv_none') :
    conv < 0.6  ? t('lab.learning_conv_partial') :
    t('lab.learning_conv_good');

  const ampFactor = lastDiagnostics?.thetaS ?? (hasModel ? Math.exp(personalModel!.thetaMean[0]) : null);
  const clrFactor = lastDiagnostics?.thetaK ?? (hasModel ? Math.exp(personalModel!.thetaMean[1]) : null);

  return (
    <div className="mx-4 bg-white rounded-2xl border border-rose-100 shadow-sm overflow-hidden">
      {/* Header – always visible */}
      <button
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-rose-50/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center">
            <Brain size={15} className="text-rose-400" />
          </div>
          <div className="text-left">
            <p className="text-sm font-bold text-gray-800">{t('lab.learning_title')}</p>
            {hasModel ? (
              <p className="text-[10px] text-gray-400">
                {personalModel!.observationCount} {t('lab.learning_obs')}
                {lastDiagnostics?.isOutlier && (
                  <span className="ml-2 text-amber-500 font-semibold">⚠</span>
                )}
              </p>
            ) : (
              <p className="text-[10px] text-gray-400">{t('lab.learning_conv_none')}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasModel && (
            <div className="w-20">
              <ConvergenceBar score={conv} />
            </div>
          )}
          {expanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
        </div>
      </button>

      {/* Expanded detail section */}
      {expanded && (
        <div className="border-t border-rose-50 px-4 py-3 space-y-1">
          {/* Description */}
          <p className="text-[10px] text-gray-400 pb-2 leading-relaxed">{t('lab.learning_desc')}</p>

          {!hasModel ? (
            <p className="text-[11px] text-gray-400 text-center py-4 leading-relaxed px-2">{t('lab.learning_conv_none')}</p>
          ) : (
            <>
              {/* Outlier warning */}
              {lastDiagnostics?.isOutlier && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2 mb-2">
                  <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-[10px] font-medium text-amber-700">{t('lab.learning_outlier')}</p>
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
              <div className="py-1.5 border-b border-gray-50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-semibold text-gray-500">{t('lab.learning_convergence')}</span>
                  <span className="text-[10px] font-bold text-gray-600">{convLabel}</span>
                </div>
                <ConvergenceBar score={conv} />
                <p className="text-[10px] text-gray-400 mt-1">{t('lab.learning_convergence_tip')}</p>
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
          ? 'border-rose-300 bg-rose-50/60'
          : 'border-gray-100 bg-gray-50/60 hover:border-gray-200 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-2.5">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 border ${
          selected ? 'bg-rose-100 border-rose-200' : 'bg-white border-gray-200'
        }`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`text-[13px] font-bold ${selected ? 'text-rose-700' : 'text-gray-800'}`}>{label}</span>
            {selected && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-600 text-[9px] font-bold">
                <CheckCircle2 size={9} />
                {t('lab.model_active')}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-500 leading-relaxed mb-1.5">{desc}</p>
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
          selected ? 'border-rose-500 bg-rose-500' : 'border-gray-300 bg-white'
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
  onAddLabResult,
  onEditLabResult,
  onClearLabResults,
}) => {
  const { t, lang } = useTranslation();

  return (
    <div className="relative space-y-5 pt-6 pb-8">
      <div className="px-4">
        <div className="w-full p-4 rounded-2xl bg-white flex items-center justify-between shadow-sm">
          <h2 className="text-xl font-semibold text-gray-900 tracking-tight flex items-center gap-3">
            <FlaskConical size={22} className="text-teal-500" /> {t('lab.title')}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={onAddLabResult}
              className="inline-flex items-center justify-center gap-2 px-3.5 py-2 h-11 rounded-xl bg-gray-900 text-white text-sm font-bold shadow-sm hover:shadow-md transition"
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
      />

      {/* E2 Calibration Model Selector */}
      <div className="mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-4 space-y-3">
        <div>
          <p className="text-sm font-bold text-gray-800">{t('lab.model_selector')}</p>
          <p className="text-[11px] text-gray-500 mt-0.5 leading-relaxed">{t('lab.model_selector_desc')}</p>
        </div>
        <div className="space-y-2">
          <ModelOption
            icon={<Cpu size={14} className={calibrationModel === 'ekf' ? 'text-rose-500' : 'text-gray-500'} />}
            label={t('lab.model_ekf_label')}
            desc={t('lab.model_ekf_desc')}
            pros={[t('lab.model_ekf_pro1'), t('lab.model_ekf_pro2')]}
            con={t('lab.model_ekf_con')}
            selected={calibrationModel === 'ekf'}
            onSelect={() => onSetCalibrationModel('ekf')}
          />
          <ModelOption
            icon={<Waves size={14} className={calibrationModel === 'ou-kalman' ? 'text-rose-500' : 'text-gray-500'} />}
            label={t('lab.model_ou_label')}
            desc={t('lab.model_ou_desc')}
            pros={[t('lab.model_ou_pro1'), t('lab.model_ou_pro2')]}
            con={t('lab.model_ou_con')}
            selected={calibrationModel === 'ou-kalman'}
            onSelect={() => onSetCalibrationModel('ou-kalman')}
          />
        </div>
      </div>

      {/* CPA adherence toggle */}
      <div className="mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800">{t('lab.learning_apply_cpa')}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
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
                ? 'bg-rose-500 border-rose-500'
                : 'bg-gray-200 border-gray-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                applyE2LearningToCPA ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <p className="mt-2 text-[10px] font-semibold text-gray-400">
          {applyE2LearningToCPA ? t('lab.learning_apply_cpa_on') : t('lab.learning_apply_cpa_off')}
        </p>
      </div>

      {/* CPA→E2 clearance inhibition toggle */}
      <div className="mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-gray-800">{t('lab.apply_cpa_inhibition')}</p>
            <p className="text-[11px] text-gray-500 mt-1 leading-relaxed">
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
                ? 'bg-rose-500 border-rose-500'
                : 'bg-gray-200 border-gray-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                applyCPAInhibitionToE2 ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
        <p className="mt-2 text-[10px] font-semibold text-gray-400">
          {applyCPAInhibitionToE2 ? t('lab.apply_cpa_inhibition_on') : t('lab.apply_cpa_inhibition_off')}
        </p>
      </div>

      {labResults.length === 0 ? (
        <div className="mx-4 text-center py-12 text-gray-400 bg-white rounded-3xl border border-dashed border-gray-200 shadow-sm">
          <p>{t('lab.empty')}</p>
        </div>
      ) : (
        <div className="mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100 overflow-hidden">
          {labResults
            .slice()
            .sort((a, b) => b.timeH - a.timeH)
            .map(res => {
              const d = new Date(res.timeH * 3600000);
              return (
                <div
                  key={res.id}
                  className="p-4 flex items-center gap-4 hover:bg-gray-50 transition-all cursor-pointer group relative"
                  onClick={() => onEditLabResult(res)}
                >
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-teal-50 border border-teal-100">
                    <FlaskConical className="text-teal-500" size={18} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-gray-900 text-sm truncate">
                        {res.concValue} {res.unit}
                      </span>
                      <span className="font-mono text-[11px] font-medium text-gray-500 bg-gray-50 px-2 py-1 rounded-md border border-gray-100">
                        {formatTime(d)}
                      </span>
                    </div>
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                      {formatDate(d, lang)}
                    </div>
                  </div>
                </div>
              );
            })}
        </div>
      )}

      <div className="mx-4 bg-white rounded-2xl border border-gray-200 shadow-sm flex items-center justify-end px-4 py-3">
        <button
          onClick={onClearLabResults}
          disabled={!labResults.length}
          className={`px-3 py-2 rounded-lg text-xs font-bold transition ${
            labResults.length ? 'text-red-500 hover:bg-red-50' : 'text-gray-300 cursor-not-allowed'
          }`}
        >
          {t('lab.clear_all')}
        </button>
      </div>
    </div>
  );
};

export default LabView;
