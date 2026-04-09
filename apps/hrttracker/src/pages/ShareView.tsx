import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from '../contexts/LanguageContext';
import apiClient from '../api/client';
import ResultChart from '../components/ResultChart';
import PINInput from '../components/PINInput';
import { Share2, Lock, AlertCircle, ArrowLeft } from 'lucide-react';
import { DoseEvent, runSimulation, SimulationResult, LabResult, createCalibrationInterpolator } from '../../logic';

const ShareView: React.FC = () => {
  const { shareId } = useParams<{ shareId: string }>();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [shareData, setShareData] = useState<{
    events: DoseEvent[];
    weight: number;
    labResults: LabResult[];
  } | null>(null);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);

  useEffect(() => {
    if (shareId) {
      loadShare();
    }
  }, [shareId]);

  useEffect(() => {
    if (shareData) {
      const sim = runSimulation(shareData.events, shareData.weight);
      setSimulation(sim);
    }
  }, [shareData]);

  const loadShare = async (pwd?: string) => {
    if (!shareId) return;

    setLoading(true);
    setError('');

    const response = await apiClient.viewShare(shareId, pwd ? { password: pwd } : undefined);

    if (response.success && response.data) {
      setNeedsPassword(false);
      setShareData({
        events: response.data.data.events || [],
        weight: response.data.data.weight || 60,
        labResults: response.data.data.labResults || [],
      });
    } else {
      if (response.status === 400) {
        setNeedsPassword(true);
        setError('');
      } else if (response.status === 401) {
        setNeedsPassword(true);
        setError(t('shares.invalidPassword') || 'Incorrect password');
      } else {
        setError(response.error || 'Failed to load share');
      }
    }

    setLoading(false);
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadShare(password);
  };

  const calibrationFn = shareData
    ? createCalibrationInterpolator(simulation, shareData.labResults)
    : () => 1;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft size={24} />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Share2 size={24} className="text-pink-500" />
              {t('shares.viewTitle') || 'Shared HRT Data'}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-12 text-center">
            <p className="text-gray-500 text-lg">{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : needsPassword ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8">
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center">
                <Lock size={32} className="text-amber-600" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
              {t('shares.passwordRequired') || 'Password Required'}
            </h2>
            <p className="text-gray-600 text-center mb-6">
              {t('shares.passwordPrompt') || 'This share is password protected'}
            </p>
            <form onSubmit={handlePasswordSubmit} className="max-w-md mx-auto space-y-4">
              <div className="flex justify-center">
                <PINInput
                  value={password}
                  onChange={setPassword}
                  error={!!error}
                  autoFocus
                />
              </div>
              <p className="text-xs text-gray-500 text-center">
                {t('shares.enterPassword') || 'Enter password'}
              </p>
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-xl text-sm">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={password.length !== 6}
                className="w-full px-4 py-3 bg-pink-600 text-white rounded-xl hover:bg-pink-700 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t('btn.submit') || 'Submit'}
              </button>
            </form>
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8">
            <div className="flex items-center justify-center mb-6">
              <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center">
                <AlertCircle size={32} className="text-red-600" />
              </div>
            </div>
            <h2 className="text-xl font-bold text-gray-900 text-center mb-2">
              {t('shares.error') || 'Error'}
            </h2>
            <p className="text-gray-600 text-center">{error}</p>
          </div>
        ) : shareData ? (
          <div className="space-y-6">
            {/* Info Card */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-gray-900 mb-1">
                    {t('shares.sharedData') || 'Shared HRT Tracking Data'}
                  </h3>
                  <p className="text-sm text-gray-500">
                    {shareData.events.length} {t('shares.events') || 'events'} · {shareData.weight} kg
                  </p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-pink-50 flex items-center justify-center">
                  <Share2 size={24} className="text-pink-500" />
                </div>
              </div>
            </div>

            {/* Chart */}
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
              <ResultChart
                sim={simulation}
                events={shareData.events}
                labResults={shareData.labResults}
                onPointClick={() => {}} // Read-only
              />
            </div>

            {/* Disclaimer */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
              <div className="flex items-start gap-2">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p>
                  {t('shares.disclaimer') || 'This is read-only shared data. All data belongs to the original user.'}
                </p>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ShareView;
