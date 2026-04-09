import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from '../contexts/LanguageContext';
import { useDialog } from '../contexts/DialogContext';
import apiClient from '../api/client';
import { Smartphone, Monitor, Tablet, ArrowLeft, Trash2, Shield } from 'lucide-react';

interface Session {
  session_id: string;
  device_info: string;
  ip_address: string;
  created_at: string;
  last_used_at: string;
  is_current: boolean;
}

const AccountDevices: React.FC = () => {
  const { t } = useTranslation();
  const { showDialog } = useDialog();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [passwordModal, setPasswordModal] = useState<{
    show: boolean;
    action: 'revoke' | 'revokeAll' | null;
    sessionId?: string;
    deviceInfo?: string;
  }>({ show: false, action: null });
  const [password, setPassword] = useState('');

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoading(true);
    setError('');
    const response = await apiClient.getSessions();
    if (response.success && response.data) {
      setSessions(response.data.sessions || []);
    } else {
      setError(response.error || 'Failed to load sessions');
    }
    setLoading(false);
  };

  const handleRevokeSession = (sessionId: string, deviceInfo: string) => {
    setPasswordModal({
      show: true,
      action: 'revoke',
      sessionId,
      deviceInfo,
    });
  };

  const handleRevokeAllOthers = () => {
    setPasswordModal({
      show: true,
      action: 'revokeAll',
    });
  };

  const handlePasswordSubmit = async () => {
    if (!password) {
      showDialog('alert', t('devices.passwordRequired') || 'Password is required');
      return;
    }

    if (passwordModal.action === 'revoke' && passwordModal.sessionId) {
      const response = await apiClient.revokeSession(passwordModal.sessionId, { password });
      if (response.success) {
        showDialog('alert', t('devices.revokeSuccess') || 'Session revoked successfully');
        loadSessions();
        setPasswordModal({ show: false, action: null });
        setPassword('');
      } else {
        showDialog('alert', response.error || 'Failed to revoke session');
      }
    } else if (passwordModal.action === 'revokeAll') {
      const response = await apiClient.revokeAllOtherSessions({ password });
      if (response.success && response.data) {
        showDialog('alert', `${t('devices.revokedCount') || 'Revoked'} ${response.data.revoked_count} ${t('devices.sessions') || 'sessions'}`);
        loadSessions();
        setPasswordModal({ show: false, action: null });
        setPassword('');
      } else {
        showDialog('alert', response.error || 'Failed to revoke sessions');
      }
    }
  };

  const getDeviceIcon = (deviceInfo: string) => {
    const info = deviceInfo.toLowerCase();
    if (info.includes('mobile') || info.includes('android') || info.includes('iphone')) {
      return <Smartphone size={20} className="text-blue-500" />;
    }
    if (info.includes('tablet') || info.includes('ipad')) {
      return <Tablet size={20} className="text-blue-500" />;
    }
    return <Monitor size={20} className="text-blue-500" />;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link to="/profile" className="text-gray-600 hover:text-gray-900">
              <ArrowLeft size={24} />
            </Link>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <Smartphone size={24} className="text-pink-500" />
              {t('devices.title') || 'Devices'}
            </h1>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Revoke All Button */}
        {sessions.length > 1 && (
          <button
            onClick={handleRevokeAllOthers}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white border border-red-200 rounded-xl text-red-600 hover:bg-red-50 transition font-medium"
          >
            <Shield size={18} />
            {t('devices.revokeAll') || 'Revoke All Other Sessions'}
          </button>
        )}

        {/* Sessions List */}
        {loading ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-gray-500">{t('common.loading') || 'Loading...'}</p>
          </div>
        ) : error ? (
          <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-8 text-center">
            <p className="text-red-600">{error}</p>
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <p className="text-gray-500">{t('devices.empty') || 'No sessions found'}</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm divide-y divide-gray-100">
            {sessions.map((session) => (
              <div key={session.session_id} className="p-4">
                <div className="flex items-start gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0">
                    {getDeviceIcon(session.device_info)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 text-sm">
                          {session.device_info || 'Unknown Device'}
                        </span>
                        {session.is_current && (
                          <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full">
                            {t('devices.current') || 'Current'}
                          </span>
                        )}
                      </div>
                      {!session.is_current && (
                        <button
                          onClick={() => handleRevokeSession(session.session_id, session.device_info)}
                          className="text-red-500 hover:text-red-700 p-2"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 space-y-1">
                      <div>IP: {session.ip_address}</div>
                      <div>
                        {t('devices.lastActive') || 'Last active'}: {new Date(session.last_used_at).toLocaleString()}
                      </div>
                      <div>
                        {t('devices.created') || 'Created'}: {new Date(session.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Password Modal */}
      {passwordModal.show && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">
              {passwordModal.action === 'revoke'
                ? `${t('devices.revokeSession') || 'Revoke Session'} - ${passwordModal.deviceInfo}`
                : t('devices.revokeAll') || 'Revoke All Other Sessions'}
            </h3>

            <p className="text-sm text-gray-600 mb-4">
              {t('devices.enterPasswordConfirm') || 'Enter your account password to confirm'}
            </p>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
              placeholder={t('devices.password') || 'Password'}
              className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 mb-4"
              autoFocus
            />

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPasswordModal({ show: false, action: null });
                  setPassword('');
                }}
                className="flex-1 bg-gray-200 text-gray-700 py-3 px-4 rounded-xl font-medium hover:bg-gray-300 transition"
              >
                {t('common.cancel') || 'Cancel'}
              </button>
              <button
                onClick={handlePasswordSubmit}
                className="flex-1 bg-red-600 text-white py-3 px-4 rounded-xl font-medium hover:bg-red-700 transition"
              >
                {t('common.confirm') || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AccountDevices;
