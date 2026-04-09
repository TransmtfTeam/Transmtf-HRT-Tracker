import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import apiClient from '../api/client';
import type { OIDCBindStatusResponse } from '../api/types';
import { ArrowLeft, Link2, Loader2, Lock, Shield, Unlink } from 'lucide-react';

const AccountOIDC: React.FC = () => {
  const { accessToken, logout } = useAuth();
  const { t } = useTranslation();
  const { showDialog } = useDialog();
  const navigate = useNavigate();

  const [status, setStatus] = useState<OIDCBindStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bindingInProgress, setBindingInProgress] = useState(false);

  // Set password modal
  const [showSetPasswordModal, setShowSetPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [settingPassword, setSettingPassword] = useState(false);
  const [setPasswordError, setSetPasswordError] = useState('');

  // Remove password modal
  const [showRemovePasswordModal, setShowRemovePasswordModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [removingPassword, setRemovingPassword] = useState(false);
  const [removePasswordError, setRemovePasswordError] = useState('');

  useEffect(() => {
    loadStatus();
  }, []);

  const loadStatus = async () => {
    setLoading(true);
    setError('');
    const response = await apiClient.getOIDCBindStatus();
    if (response.success && response.data) {
      setStatus(response.data);
    } else {
      setError(response.error || 'Failed to load OIDC status');
    }
    setLoading(false);
  };

  const handleBind = async () => {
    const confirmed = await showDialog(
      'confirm',
      t('oidc.bindWarning') || 'OIDC binding is permanent and cannot be undone. Continue?',
      {
        confirmText: t('oidc.bindButton') || 'Link Transmtf Account',
        cancelText: t('btn.cancel') || 'Cancel',
      },
    );
    if (confirmed !== 'confirm') return;

    setBindingInProgress(true);
    const response = await apiClient.getOIDCBindAuthorizeUrl();
    setBindingInProgress(false);

    if (response.success && response.data) {
      const { auth_url, state } = response.data;
      sessionStorage.setItem('oidc_state', state);
      sessionStorage.setItem('oidc_action', 'bind');
      window.location.href = auth_url;
    } else {
      showDialog('alert', response.error || 'Failed to start binding flow.');
    }
  };

  const handleSetPassword = async () => {
    setSetPasswordError('');

    if (!newPassword) {
      setSetPasswordError(t('account.passwordRequired') || 'Password is required');
      return;
    }
    if (newPassword.length < 8) {
      setSetPasswordError(t('account.passwordTooShort') || 'Password must be at least 8 characters');
      return;
    }
    if (!/[a-zA-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setSetPasswordError(t('account.passwordComplexity') || 'Password must contain at least one letter and one number');
      return;
    }

    setSettingPassword(true);
    const response = await apiClient.setLoginPassword({ password: newPassword });
    setSettingPassword(false);

    if (response.success) {
      showDialog('alert', t('oidc.setPasswordSuccess') || 'Login password set successfully.');
      setShowSetPasswordModal(false);
      setNewPassword('');
      loadStatus();
    } else {
      setSetPasswordError(response.error || 'Failed to set password');
    }
  };

  const handleRemovePassword = async () => {
    setRemovePasswordError('');

    if (!currentPassword) {
      setRemovePasswordError(t('account.passwordRequired') || 'Password is required');
      return;
    }

    setRemovingPassword(true);
    const response = await apiClient.removeLoginPassword({ password: currentPassword });
    setRemovingPassword(false);

    if (response.success) {
      await showDialog('alert', t('oidc.removePasswordSuccess') || 'Login password removed. Please sign in with Transmtf.');
      setShowRemovePasswordModal(false);
      setCurrentPassword('');
      // All sessions are logged out by the server; log out locally too
      await logout(false);
      navigate('/login', { replace: true });
    } else {
      setRemovePasswordError(response.error || 'Failed to remove password');
    }
  };

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center px-4 py-6">
        <Loader2 className="text-pink-500 animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-full px-4 py-6">
      <div className="mx-auto w-full max-w-2xl space-y-6">
        <div className="flex items-center gap-3">
          <Link
            to="/profile"
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 transition"
          >
            <ArrowLeft size={16} />
            {t('account.title') || 'Profile'}
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900">{t('oidc.title') || 'Transmtf Identity'}</h1>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* OIDC Binding Status */}
        <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-3">
            <Link2 size={20} className="text-blue-500" />
            <h3 className="font-bold text-gray-900">{t('account.oidc') || 'Transmtf Login'}</h3>
          </div>

          {status?.bound ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <Shield size={12} />
                  {t('oidc.status.bound') || 'Linked'}
                </span>
                <span className="text-xs text-gray-500">{t('oidc.bound_permanent') || 'Permanently linked — cannot be unlinked'}</span>
              </div>

              {status.oidc_email && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('oidc.email') || 'Email'}:</span>
                  <span className="font-medium text-gray-900">{status.oidc_email}</span>
                </div>
              )}
              {status.provider && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('oidc.provider') || 'Provider'}:</span>
                  <span className="font-medium text-gray-900 break-all text-right max-w-xs">{status.provider}</span>
                </div>
              )}
              {status.oidc_subject && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">{t('oidc.subject') || 'Identity ID'}:</span>
                  <span className="font-mono text-xs text-gray-600 break-all text-right max-w-xs">{status.oidc_subject}</span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">
                {t('oidc.status.notBound') || 'No Transmtf identity linked to this account.'}
              </p>
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                {t('oidc.bindWarning') || 'OIDC binding is permanent and cannot be undone. Once linked, the Transmtf identity cannot be changed or removed.'}
              </div>
              <button
                onClick={handleBind}
                disabled={bindingInProgress}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bindingInProgress ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t('oidc.binding') || 'Linking...'}
                  </>
                ) : (
                  <>
                    <Link2 size={16} />
                    {t('oidc.bindButton') || 'Link Transmtf Account'}
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Password Management */}
        {status && (
          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <Lock size={20} className="text-gray-600" />
              <h3 className="font-bold text-gray-900">{t('account.changePassword') || 'Login Password'}</h3>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t('account.status') || 'Status'}:</span>
                <span className={`font-medium ${status.has_password ? 'text-green-600' : 'text-amber-600'}`}>
                  {status.has_password
                    ? (t('oidc.hasPassword') || 'Password set')
                    : (t('oidc.noPassword') || 'No login password')}
                </span>
              </div>

              {!status.has_password && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">
                    {t('oidc.noPasswordDesc') || 'This account has no login password. You can set one to allow password-based login in addition to Transmtf.'}
                  </p>
                  <button
                    onClick={() => {
                      setNewPassword('');
                      setSetPasswordError('');
                      setShowSetPasswordModal(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                  >
                    <Lock size={16} />
                    {t('oidc.setPassword') || 'Set Login Password'}
                  </button>
                </div>
              )}

              {status.has_password && status.bound && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">
                    {t('oidc.removePasswordDesc') || 'You can remove your login password and use Transmtf as your only login method.'}
                  </p>
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {t('oidc.removePasswordWarning') || 'Removing the password will log out all current sessions. You will need to sign in with Transmtf.'}
                  </div>
                  <button
                    onClick={() => {
                      setCurrentPassword('');
                      setRemovePasswordError('');
                      setShowRemovePasswordModal(true);
                    }}
                    className="inline-flex items-center gap-2 rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    <Unlink size={16} />
                    {t('oidc.removePassword') || 'Remove Login Password'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Set Password Modal */}
      {showSetPasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
              <Lock size={24} className="text-pink-500" />
              {t('oidc.setPasswordTitle') || 'Set Login Password'}
            </h3>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t('oidc.newPassword') || 'New Password'}
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-pink-500"
                  placeholder={t('oidc.passwordPlaceholder') || 'At least 8 characters with letters and numbers'}
                  disabled={settingPassword}
                />
              </div>

              {setPasswordError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {setPasswordError}
                </div>
              )}

              <div className="space-y-1 text-xs text-gray-500">
                <p>- {t('account.passwordRequirement1') || 'At least 8 characters'}</p>
                <p>- {t('account.passwordRequirement2') || 'Contains at least one letter and one number'}</p>
              </div>
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowSetPasswordModal(false)}
                disabled={settingPassword}
                className="flex-1 rounded-xl border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {t('btn.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleSetPassword}
                disabled={settingPassword}
                className="flex-1 rounded-xl bg-pink-600 px-4 py-3 font-medium text-white transition hover:bg-pink-700 disabled:opacity-50"
              >
                {settingPassword ? (t('oidc.loading') || 'Saving...') : (t('btn.confirm') || 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Password Modal */}
      {showRemovePasswordModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-bold text-gray-900">
              <Unlink size={24} className="text-red-500" />
              {t('oidc.removePasswordTitle') || 'Remove Login Password'}
            </h3>

            <div className="space-y-4">
              <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {t('oidc.removePasswordWarning') || 'All sessions will be logged out. You will need to sign in with Transmtf.'}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  {t('oidc.currentPassword') || 'Current Password'}
                </label>
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder={t('oidc.currentPasswordPlaceholder') || 'Enter current password'}
                  disabled={removingPassword}
                />
              </div>

              {removePasswordError && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">
                  {removePasswordError}
                </div>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowRemovePasswordModal(false)}
                disabled={removingPassword}
                className="flex-1 rounded-xl border border-gray-300 px-4 py-3 font-medium text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {t('btn.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handleRemovePassword}
                disabled={removingPassword}
                className="flex-1 rounded-xl bg-red-600 px-4 py-3 font-medium text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {removingPassword ? (t('oidc.loading') || 'Processing...') : (t('oidc.removePassword') || 'Remove Password')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountOIDC;
