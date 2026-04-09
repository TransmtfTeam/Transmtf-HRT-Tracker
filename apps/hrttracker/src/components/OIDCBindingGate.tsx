import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../contexts/LanguageContext';
import apiClient from '../api/client';
import { AlertTriangle, Loader2, ShieldAlert } from 'lucide-react';

// Pages where the gate must not block (exact match)
const EXEMPT_PATHS = new Set(['/login', '/register', '/auth/oidc/callback', '/account/oidc']);

type GatePhase = 'idle' | 'binding_required' | 'off';

const OIDCBindingGate: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  const [phase, setPhase] = useState<GatePhase>('idle');
  const [startingBind, setStartingBind] = useState(false);
  const [bindError, setBindError] = useState('');

  const hasCheckedRef = useRef(false);
  // Stale-async cancellation: increment on each new check, discard outdated results
  const checkIdRef = useRef(0);

  const isExempt = EXEMPT_PATHS.has(location.pathname);
  const isOnOidcPage = location.pathname === '/account/oidc';

  const checkStatus = useCallback(async () => {
    const myCheckId = ++checkIdRef.current;

    try {
      // Check OIDC config first — if OIDC disabled, gate never activates
      const configRes = await apiClient.getOIDCConfig();
      if (myCheckId !== checkIdRef.current) return; // stale

      if (!configRes.success || !configRes.data?.oidc_enabled) {
        setPhase('off');
        hasCheckedRef.current = true;
        return;
      }

      // Check bind status: bound + has_password = Phase 2, not bound = Phase 1
      const statusRes = await apiClient.getOIDCBindStatus();
      if (myCheckId !== checkIdRef.current) return; // stale

      hasCheckedRef.current = true;

      if (statusRes.success && statusRes.data) {
        const { bound } = statusRes.data;
        setPhase(bound ? 'off' : 'binding_required');
      } else {
        // Can't determine status — fail open to avoid locking users out
        setPhase('off');
      }
    } catch {
      if (myCheckId !== checkIdRef.current) return;
      // Network error — fail open
      hasCheckedRef.current = true;
      setPhase('off');
    }
  }, []);

  useEffect(() => {
    if (isLoading) return;

    if (!isAuthenticated) {
      // Reset on logout so the gate re-evaluates on next login
      setPhase('idle');
      hasCheckedRef.current = false;
      // Invalidate any in-flight checks to prevent stale updates
      checkIdRef.current++;
      return;
    }

    // Re-check: first time after login, or when returning to /account/oidc
    // (the bind callback always redirects there, so this catches post-bind)
    const shouldCheck = !hasCheckedRef.current || isOnOidcPage;
    if (shouldCheck) {
      checkStatus();
    }
  }, [isAuthenticated, isLoading, isOnOidcPage, checkStatus]);

  const handleBind = async () => {
    setStartingBind(true);
    setBindError('');
    try {
      const response = await apiClient.getOIDCBindAuthorizeUrl();
      if (response.success && response.data) {
        const { auth_url, state } = response.data;
        sessionStorage.setItem('oidc_state', state);
        sessionStorage.setItem('oidc_action', 'bind');
        window.location.href = auth_url;
      } else {
        setBindError(t('oidcGate.bindError') || 'Failed to start binding. Please try again.');
      }
    } catch {
      setBindError(t('oidcGate.bindError') || 'Failed to start binding. Please try again.');
    } finally {
      setStartingBind(false);
    }
  };

  // Show gate only when: active phase + authenticated + not on an exempt page
  if (phase === 'idle' || phase === 'off' || !isAuthenticated || isExempt) {
    return null;
  }

  // --- Phase 1: Must bind Transmtf ---
  if (phase === 'binding_required') {
    return (
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center px-4 py-6 overflow-y-auto"
        style={{ background: 'linear-gradient(160deg, rgba(15,23,42,0.97) 0%, rgba(30,27,75,0.97) 50%, rgba(15,23,42,0.97) 100%)', backdropFilter: 'blur(24px)' }}
      >
        <div className="w-full max-w-sm mx-auto my-auto animate-gate-in">
          <div className="flex flex-col items-center mb-8">
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-5 bg-red-500/15 ring-4 ring-red-500/25">
              <ShieldAlert size={38} className="text-red-400" strokeWidth={1.8} />
            </div>
            <h2 className="text-2xl font-bold text-white text-center mb-2">
              {t('oidcGate.title') || 'Security Verification Required'}
            </h2>
            <p className="text-sm text-gray-400 text-center max-w-xs leading-relaxed">
              {t('oidcGate.subtitle') || 'You must link your Transmtf identity to continue'}
            </p>
          </div>

          <div className="mb-8 space-y-3">
            {[
              t('oidcGate.reason1') || 'Password-only accounts are vulnerable to brute force and phishing attacks',
              t('oidcGate.reason2') || 'Linking Transmtf protects your account even if your password is compromised',
              t('oidcGate.reason3') || 'This is a one-time permanent action. After binding, you can still sign in with either your password or Transmtf',
            ].map((reason, i) => (
              <div key={i} className="flex items-start gap-3 bg-white/5 rounded-2xl px-4 py-3 border border-white/8">
                <AlertTriangle size={15} className="text-amber-400 flex-shrink-0 mt-0.5" strokeWidth={2.2} />
                <p className="text-xs text-gray-300 leading-relaxed">{reason}</p>
              </div>
            ))}
          </div>

          {bindError && (
            <p className="text-red-400 text-xs text-center mb-4">{bindError}</p>
          )}

          <button
            onClick={handleBind}
            disabled={startingBind}
            className="w-full flex items-center justify-center gap-2.5 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl transition-all duration-200 shadow-lg shadow-blue-900/40 text-sm"
          >
            {startingBind ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                {t('oidcGate.binding') || 'Redirecting...'}
              </>
            ) : (
              t('oidcGate.bindButton') || 'Link Transmtf Now'
            )}
          </button>
        </div>

        <style>{`
          @keyframes gate-in {
            from { opacity: 0; transform: scale(0.97) translateY(12px); }
            to   { opacity: 1; transform: scale(1)    translateY(0); }
          }
          .animate-gate-in {
            animation: gate-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          }
        `}</style>
      </div>
    );
  }
};

export default OIDCBindingGate;
