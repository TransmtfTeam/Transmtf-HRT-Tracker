import React, { useState, useEffect } from 'react';
import { useTranslation } from '../contexts/LanguageContext';
import { BarChart2, Users, Activity, Database, Calendar, Loader2, AlertCircle } from 'lucide-react';
import { apiClient } from '../api/client';
import type { StatisticsResponse } from '../api/types';

interface StatisticsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const StatisticsModal: React.FC<StatisticsModalProps> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StatisticsResponse | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadStatistics();
    }
  }, [isOpen]);

  const loadStatistics = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log('[StatisticsModal] Loading statistics from:', apiClient);
      const response = await apiClient.getStatistics();
      console.log('[StatisticsModal] Response:', response);

      // Check if response has the expected fields (direct data or wrapped in ApiResponse)
      if (response.total_users !== undefined) {
        // Direct response format
        setStats(response as any);
      } else if (response.success && response.data) {
        // Wrapped ApiResponse format
        setStats(response.data);
      } else {
        setError(response.error || t('statistics.error.load_failed'));
      }
    } catch (err) {
      console.error('Failed to load statistics:', err);
      setError(t('statistics.error.network'));
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleString();
    } catch {
      return dateString;
    }
  };

  const formatDatabaseSize = (sizeMB: number) => {
    if (sizeMB < 1) {
      return `${(sizeMB * 1024).toFixed(2)} KB`;
    } else if (sizeMB < 1024) {
      return `${sizeMB.toFixed(2)} MB`;
    } else {
      return `${(sizeMB / 1024).toFixed(2)} GB`;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end md:items-center justify-center z-[60] animate-in fade-in duration-200 p-4">
      <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 w-full max-w-lg p-6 md:p-8 animate-in slide-in-from-bottom duration-300">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center mb-3">
            <BarChart2 className="text-blue-500" size={24} />
          </div>
          <h3 className="text-xl font-bold text-gray-900 text-center">{t('statistics.title')}</h3>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="text-blue-500 animate-spin mb-3" size={32} />
            <p className="text-sm text-gray-500">{t('statistics.loading')}</p>
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-12">
            <AlertCircle className="text-red-500 mb-3" size={32} />
            <p className="text-sm text-red-600 text-center">{error}</p>
            <button
              onClick={loadStatistics}
              className="mt-4 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded-xl hover:bg-blue-600 transition"
            >
              {t('statistics.retry')}
            </button>
          </div>
        )}

        {stats && !loading && !error && (
          <div className="space-y-4 mb-8">
            <div className="flex items-center gap-4 p-4 bg-purple-50 rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                <Users className="text-purple-600" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-600">{t('statistics.total_users')}</p>
                <p className="text-lg font-bold text-gray-900">{stats.total_users.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 bg-green-50 rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
                <Activity className="text-green-600" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-600">{t('statistics.syncs_last_7_days')}</p>
                <p className="text-lg font-bold text-gray-900">{stats.data_syncs_last_7days.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Database className="text-blue-600" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-600">{t('statistics.database_size')}</p>
                <p className="text-lg font-bold text-gray-900">{formatDatabaseSize(stats.database_size_mb)}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 p-4 bg-amber-50 rounded-2xl">
              <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                <Calendar className="text-amber-600" size={20} />
              </div>
              <div className="flex-1">
                <p className="text-xs text-gray-600">{t('statistics.last_updated')}</p>
                <p className="text-sm font-bold text-gray-900">{formatDate(stats.last_updated_at)}</p>
              </div>
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full py-3.5 bg-gray-900 text-white font-bold rounded-xl hover:bg-gray-800 transition"
        >
          {t('btn.ok')}
        </button>
      </div>
    </div>
  );
};

export default StatisticsModal;
