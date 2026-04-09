import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, AlertCircle, CheckCircle } from 'lucide-react';
import { useTranslation } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import apiClient from '../api/client';
import PINInput from '../components/PINInput';
import { saveSecurityPassword } from '../utils/crypto';

const SecurityPassword: React.FC = () => {
  const { t } = useTranslation();
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();

  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<'view' | 'set' | 'change'>('view');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [oldPassword, setOldPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    checkPasswordStatus();
  }, [isAuthenticated, navigate]);

  const checkPasswordStatus = async () => {
    setIsLoading(true);
    const response = await apiClient.getSecurityPasswordStatus();

    if (response.success && response.data) {
      setHasPassword(response.data.has_security_password);
      setMode(response.data.has_security_password ? 'view' : 'set');
    }

    setIsLoading(false);
  };

  const handleSetPassword = async () => {
    setError('');
    setSuccess('');

    if (newPassword.length !== 6 || !/^\d{6}$/.test(newPassword)) {
      setError(t('security.error.invalid') || 'Password must be 6 digits');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('security.error.mismatch') || 'Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    const response = await apiClient.setSecurityPassword({ password: newPassword });
    setIsSubmitting(false);

    if (response.success) {
      setSuccess(t('security.success.set') || 'Security password set successfully');

      // 保存密码到 Cookie（加密，7天过期）
      if (user?.username) {
        await saveSecurityPassword(newPassword, user.username);
      }

      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setHasPassword(true);
        setMode('view');
      }, 1500);
    } else {
      setError(response.error || 'Failed to set password');
    }
  };

  const handleChangePassword = async () => {
    setError('');
    setSuccess('');

    if (!oldPassword || oldPassword.length !== 6) {
      setError(t('security.error.oldRequired') || 'Please enter old password');
      return;
    }

    if (newPassword.length !== 6 || !/^\d{6}$/.test(newPassword)) {
      setError(t('security.error.invalid') || 'New password must be 6 digits');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('security.error.mismatch') || 'Passwords do not match');
      return;
    }

    setIsSubmitting(true);
    const response = await apiClient.updateSecurityPassword({
      old_password: oldPassword,
      new_password: newPassword,
    });
    setIsSubmitting(false);

    if (response.success) {
      setSuccess(t('security.success.changed') || 'Security password changed successfully');

      // 保存新密码到 Cookie（加密，7天过期）
      if (user?.username) {
        await saveSecurityPassword(newPassword, user.username);
      }

      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => {
        setMode('view');
      }, 1500);
    } else {
      setError(response.error || 'Failed to change password');
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">{t('common.loading') || 'Loading...'}</div>
      </div>
    );
  }

  return (
    <div className="w-full h-full overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-12 h-12 rounded-full bg-pink-100 flex items-center justify-center">
              <Lock size={24} className="text-pink-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                {t('security.title') || 'Security Password'}
              </h2>
              <p className="text-sm text-gray-500">
                {t('security.subtitle') || '6-digit PIN to protect your data'}
              </p>
            </div>
          </div>

          {mode === 'view' && hasPassword && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 bg-green-50 p-4 rounded-xl">
                <CheckCircle size={20} />
                <span className="font-medium">
                  {t('security.status.active') || 'Security password is active'}
                </span>
              </div>

              <button
                onClick={() => setMode('change')}
                className="w-full bg-gray-900 text-white py-3 px-4 rounded-xl font-medium hover:bg-gray-800 transition"
              >
                {t('security.btn.change') || 'Change Security Password'}
              </button>
            </div>
          )}

          {mode === 'set' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('security.label.new') || 'New Security Password'}
                </label>
                <PINInput
                  value={newPassword}
                  onChange={setNewPassword}
                  error={!!error && error.includes('digit')}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('security.label.confirm') || 'Confirm Password'}
                </label>
                <PINInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  error={!!error && error.includes('match')}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-xl text-sm">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-xl text-sm">
                  <CheckCircle size={18} />
                  <span>{success}</span>
                </div>
              )}

              <button
                onClick={handleSetPassword}
                disabled={isSubmitting || newPassword.length !== 6 || confirmPassword.length !== 6}
                className="w-full bg-pink-600 text-white py-3 px-4 rounded-xl font-medium hover:bg-pink-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSubmitting
                  ? (t('common.submitting') || 'Submitting...')
                  : (t('security.btn.set') || 'Set Security Password')}
              </button>
            </div>
          )}

          {mode === 'change' && (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('security.label.old') || 'Current Password'}
                </label>
                <PINInput
                  value={oldPassword}
                  onChange={setOldPassword}
                  error={!!error && error.includes('old')}
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('security.label.new') || 'New Password'}
                </label>
                <PINInput
                  value={newPassword}
                  onChange={setNewPassword}
                  error={!!error && error.includes('digit')}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  {t('security.label.confirm') || 'Confirm New Password'}
                </label>
                <PINInput
                  value={confirmPassword}
                  onChange={setConfirmPassword}
                  error={!!error && error.includes('match')}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 p-3 rounded-xl text-sm">
                  <AlertCircle size={18} />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 text-green-600 bg-green-50 p-3 rounded-xl text-sm">
                  <CheckCircle size={18} />
                  <span>{success}</span>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setMode('view');
                    setOldPassword('');
                    setNewPassword('');
                    setConfirmPassword('');
                    setError('');
                  }}
                  className="flex-1 bg-gray-200 text-gray-700 py-3 px-4 rounded-xl font-medium hover:bg-gray-300 transition"
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                <button
                  onClick={handleChangePassword}
                  disabled={
                    isSubmitting ||
                    oldPassword.length !== 6 ||
                    newPassword.length !== 6 ||
                    confirmPassword.length !== 6
                  }
                  className="flex-1 bg-pink-600 text-white py-3 px-4 rounded-xl font-medium hover:bg-pink-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isSubmitting
                    ? (t('common.submitting') || 'Submitting...')
                    : (t('security.btn.update') || 'Update Password')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
          <h3 className="font-semibold text-blue-900 mb-2 flex items-center gap-2">
            <AlertCircle size={18} />
            {t('security.info.title') || 'Important'}
          </h3>
          <ul className="text-sm text-blue-800 space-y-1 ml-6 list-disc">
            <li>{t('security.info.1') || 'Use 6 digits (0-9) only'}</li>
            <li>{t('security.info.2') || 'This password encrypts your data'}</li>
            <li className="text-red-600 font-semibold">
              {t('security.info.warning') || 'If you forget this password, your encrypted data cannot be recovered'}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default SecurityPassword;
