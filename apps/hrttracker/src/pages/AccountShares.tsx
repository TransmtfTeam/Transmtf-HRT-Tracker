import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import { useAuth } from '../contexts/AuthContext';
import { useSecurityPassword } from '../contexts/SecurityPasswordContext';
import apiClient from '../api/client';
import type { Share, ShareType } from '../api/types';
import { Share2, ArrowLeft, Plus, Copy, Trash2, Lock, Unlock, Eye, Clock, Zap } from 'lucide-react';
import { getSecurityPassword } from '../utils/crypto';
import PINInput from '../components/PINInput';

const MAX_ATTEMPT_OPTIONS = [0, 5, 10, 20, 50];

const AccountShares: React.FC = () => {
  const { t } = useTranslation();
  const { showDialog } = useDialog();
  const { user } = useAuth();
  const { hasSecurityPassword } = useSecurityPassword();
  const [shares, setShares] = useState<Share[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [shareHasPassword, setShareHasPassword] = useState(false);
  const [sharePassword, setSharePassword] = useState('');
  const [shareType, setShareType] = useState<ShareType>('copy');
  const [maxAttemptsSelection, setMaxAttemptsSelection] = useState('0');
  const [shareMaxAttempts, setShareMaxAttempts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const maxAttemptOptions = useMemo(
    () => MAX_ATTEMPT_OPTIONS.map((value) => ({
      value: value.toString(),
      label: value === 0 ? (t('shares.unlimited') || 'Unlimited') : value.toString(),
    })),
    [t]
  );

  useEffect(() => {
    loadShares();
  }, []);

  const loadShares = async () => {
    setLoading(true);
    const response = await apiClient.getShares();
    if (response.success && response.data) {
      setShares(response.data);
      setShareMaxAttempts(
        response.data.reduce<Record<string, string>>((acc, share) => {
          acc[share.share_id] = share.max_attempts.toString();
          return acc;
        }, {})
      );
    }
    setLoading(false);
  };

  const handleCreateShare = async () => {
    setError('');
    if (shareType === 'realtime' && hasSecurityPassword) {
      setError(t('shares.realtimeDisabled') || 'Realtime share is unavailable when security password is enabled.');
      return;
    }

    if (shareHasPassword && !/^\d{6}$/.test(sharePassword)) {
      setError(t('shares.invalidPasswordFormat') || 'Password must be 6 digits');
      return;
    }

    const parsedMaxAttempts = Number.parseInt(maxAttemptsSelection, 10);
    if (Number.isNaN(parsedMaxAttempts) || parsedMaxAttempts < 0) {
      setError(t('shares.invalidMaxAttempts') || 'Max attempts cannot be negative');
      return;
    }

    let securityPassword: string | undefined;
    if (shareType === 'copy' && hasSecurityPassword) {
      if (!user?.username) {
        setError(t('shares.securityPasswordRequired') || 'Security password required to create a copy share.');
        return;
      }
      const savedPassword = await getSecurityPassword(user.username);
      if (!savedPassword) {
        setError(t('shares.securityPasswordRequired') || 'Security password required to create a copy share.');
        return;
      }
      securityPassword = savedPassword;
    }

    const response = await apiClient.createShare({
      share_type: shareType,
      password: shareHasPassword ? sharePassword : undefined,
      security_password: securityPassword,
      max_attempts: shareHasPassword ? parsedMaxAttempts : undefined,
    });

    if (response.success && response.data) {
      setShowCreateModal(false);
      setShareHasPassword(false);
      setSharePassword('');
      setShareType('copy');
      setMaxAttemptsSelection('0');

      const shareUrl = `${window.location.origin}/share/${response.data.share_id}`;
      const shareTypeText = shareType === 'copy'
        ? (t('shares.typeCopy') || '副本分享')
        : (t('shares.typeRealtime') || '实时分享');
      const message = shareHasPassword
        ? `${shareTypeText}\n${t('shares.shareCreatedWithPassword') || 'Share created! URL copied to clipboard. Password:'} ${sharePassword}\n\n${shareUrl}`
        : `${shareTypeText}\n${t('shares.shareCreated') || 'Share created! URL copied to clipboard:'}\n\n${shareUrl}`;

      navigator.clipboard.writeText(shareUrl);
      showDialog('alert', message);
      loadShares();
    } else {
      setError(response.error || 'Failed to create share');
    }
  };

  const handleCopyShareUrl = (shareId: string) => {
    const url = `${window.location.origin}/share/${shareId}`;
    navigator.clipboard.writeText(url);
    showDialog('alert', t('shares.urlCopied') || 'Share URL copied to clipboard');
  };

  const handleUpdateLock = async (shareId: string) => {
    const value = shareMaxAttempts[shareId];
    const parsed = Number.parseInt(value, 10);

    if (Number.isNaN(parsed) || parsed < 0) {
      showDialog('alert', t('shares.invalidMaxAttempts') || 'Max attempts cannot be negative');
      return;
    }

    const response = await apiClient.updateShareLock(shareId, {
      max_attempts: parsed,
    });

    if (response.success) {
      showDialog('alert', t('shares.lockSettingsUpdated') || 'Share lock settings updated');
      loadShares();
    } else {
      showDialog('alert', response.error || 'Failed to update share');
    }
  };

  const handleDeleteShare = (shareId: string) => {
    showDialog('confirm', t('shares.deleteConfirm') || 'Delete this share?', async () => {
      const response = await apiClient.deleteShare(shareId);
      if (response.success) {
        showDialog('alert', t('shares.deleted') || 'Share deleted');
        loadShares();
      } else {
        showDialog('alert', response.error || 'Failed to delete share');
      }
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center gap-4">
            <Link to="/profile" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft size={24} />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Share2 size={24} className="text-pink-500" />
              {t('shares.title') || 'Shares'}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Create Button */}
        <button
          onClick={() => setShowCreateModal(true)}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-pink-600 text-white rounded-xl hover:bg-pink-700 transition font-medium"
        >
          <Plus size={18} />
          {t('shares.create') || 'Create New Share'}
        </button>

        {/* Shares List */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-gray-500">{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : shares.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-gray-500">{t('shares.empty') || 'No shares yet'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
            {shares.map((share) => (
              <div key={share.share_id} className="p-4 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                    share.share_type === 'realtime' ? 'bg-blue-50' : 'bg-pink-50'
                  }`}>
                    {share.share_type === 'realtime' ? (
                      <Zap size={20} className="text-blue-500" />
                    ) : (
                      <Clock size={20} className="text-pink-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded font-mono break-all">
                        {share.share_id}
                      </code>
                      <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${
                        share.share_type === 'realtime'
                          ? 'bg-blue-100 text-blue-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}>
                        {share.share_type === 'realtime'
                          ? (t('shares.typeRealtime') || '实时')
                          : (t('shares.typeCopy') || '副本')}
                      </span>
                      {share.has_password && (
                        <Lock size={14} className="text-gray-500" />
                      )}
                      {share.is_locked && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                          {t('shares.locked') || 'Locked'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 grid gap-1 mb-3 sm:grid-cols-2">
                      <div className="flex items-center gap-2">
                        <Eye size={12} />
                        {t('shares.views') || 'Views'}: {share.view_count}
                      </div>
                      <div className="sm:text-right">
                        {t('shares.attempts') || 'Attempts'}: {share.attempt_count}
                        {share.has_password
                          ? ` / ${share.max_attempts === 0 ? (t('shares.unlimited') || 'Unlimited') : share.max_attempts}`
                          : ''}
                      </div>
                      <div className="sm:col-span-2">
                        {t('shares.created') || 'Created'}: {new Date(share.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
                      <button
                        onClick={() => handleCopyShareUrl(share.share_id)}
                        className="w-full sm:w-auto flex items-center justify-center gap-1 px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition text-xs font-medium"
                      >
                        <Copy size={14} />
                        {t('shares.copyUrl') || 'Copy URL'}
                      </button>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 w-full sm:w-auto">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <select
                            value={shareMaxAttempts[share.share_id] ?? '0'}
                            onChange={(e) => {
                              setShareMaxAttempts((prev) => ({
                                ...prev,
                                [share.share_id]: e.target.value,
                              }));
                            }}
                            disabled={!share.has_password}
                            className="w-full sm:w-auto bg-white border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-pink-500"
                          >
                            {maxAttemptOptions.map((option) => (
                              <option key={`${share.share_id}-${option.value}`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                          <span className="text-xs text-gray-500">{t('shares.maxAttempts') || 'Max attempts'}</span>
                        </div>
                        <button
                          onClick={() => handleUpdateLock(share.share_id)}
                          disabled={!share.has_password}
                          className={`w-full sm:w-auto flex items-center justify-center gap-1 px-2 py-1 rounded-md transition text-xs font-medium ${
                            share.has_password
                              ? 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          }`}
                        >
                          {share.is_locked ? <Unlock size={14} /> : <Lock size={14} />}
                          {t('shares.updateLock') || 'Update lock'}
                        </button>
                      </div>
                      <button
                        onClick={() => handleDeleteShare(share.share_id)}
                        className="w-full sm:w-auto flex items-center justify-center gap-1 px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition text-xs font-medium"
                      >
                        <Trash2 size={14} />
                        {t('shares.delete') || 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Share Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-xl">
            <h3 className="text-xl font-bold text-gray-900 mb-4">
              {t('shares.createNew') || 'Create New Share'}
            </h3>

            {/* Share Type Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('shares.shareType') || '分享类型'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setShareType('copy')}
                  className={`flex flex-col items-center gap-2 px-4 py-3 rounded-xl border-2 transition ${
                    shareType === 'copy'
                      ? 'border-pink-500 bg-pink-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <Clock size={24} className={shareType === 'copy' ? 'text-pink-500' : 'text-gray-400'} />
                  <span className={`text-sm font-medium ${shareType === 'copy' ? 'text-pink-900' : 'text-gray-600'}`}>
                    {t('shares.typeCopy') || '副本分享'}
                  </span>
                  <span className="text-xs text-gray-500 text-center">
                    {t('shares.typeCopyDesc') || '分享当前数据快照'}
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (!hasSecurityPassword) {
                      setShareType('realtime');
                    }
                  }}
                  disabled={!!hasSecurityPassword}
                  className={`flex flex-col items-center gap-2 px-4 py-3 rounded-xl border-2 transition ${
                    shareType === 'realtime'
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  } ${hasSecurityPassword ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Zap size={24} className={shareType === 'realtime' ? 'text-blue-500' : 'text-gray-400'} />
                  <span className={`text-sm font-medium ${shareType === 'realtime' ? 'text-blue-900' : 'text-gray-600'}`}>
                    {t('shares.typeRealtime') || '实时分享'}
                  </span>
                  <span className="text-xs text-gray-500 text-center">
                    {t('shares.typeRealtimeDesc') || '始终显示最新数据'}
                  </span>
                </button>
              </div>
              {hasSecurityPassword && (
                <p className="text-xs text-amber-600 mt-2">
                  {t('shares.realtimeDisabled') || 'Realtime share is unavailable when security password is enabled.'}
                </p>
              )}
            </div>

            {/* Password */}
            <p className="text-sm text-gray-600 mb-2">
              {t('shares.createDesc') || 'Optionally set a password to protect this share'}
            </p>
            <div className="flex items-center justify-between gap-3 mb-4">
              <label className="text-sm font-medium text-gray-700">
                {t('shares.enablePassword') || 'Enable password protection'}
              </label>
              <button
                type="button"
                onClick={() => {
                  setShareHasPassword((prev) => {
                    const next = !prev;
                    if (!next) {
                      setSharePassword('');
                      setMaxAttemptsSelection('0');
                    }
                    return next;
                  });
                }}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
                  shareHasPassword ? 'bg-pink-600' : 'bg-gray-300'
                }`}
                aria-pressed={shareHasPassword}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                    shareHasPassword ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            {shareHasPassword && (
              <div className="mb-4 space-y-3">
                <div className="flex justify-center">
                  <PINInput
                    value={sharePassword}
                    onChange={setSharePassword}
                    error={!!error && error.includes('digit')}
                  />
                </div>
                <p className="text-xs text-gray-500 text-center">
                  {t('shares.passwordHint') || 'Use 6 digits. Leave empty for public share.'}
                </p>
              </div>
            )}

            {shareHasPassword && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {t('shares.maxAttempts') || 'Max attempts'}
                </label>
                <select
                  value={maxAttemptsSelection}
                  onChange={(e) => setMaxAttemptsSelection(e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500"
                >
                  {maxAttemptOptions.map((option) => (
                    <option key={`create-${option.value}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-2">
                  {t('shares.maxAttemptsHint') || 'Leave empty to use a large number (e.g. 999999) for unlimited.'}
                </p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-xl text-sm mb-4">
                {error}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setShareHasPassword(false);
                  setSharePassword('');
                  setShareType('copy');
                  setMaxAttemptsSelection('0');
                  setError('');
                }}
                className="flex-1 px-4 py-3 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 transition font-medium"
              >
                {t('btn.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleCreateShare}
                className="flex-1 px-4 py-3 bg-pink-600 text-white rounded-xl hover:bg-pink-700 transition font-medium"
              >
                {t('btn.create') || 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountShares;
