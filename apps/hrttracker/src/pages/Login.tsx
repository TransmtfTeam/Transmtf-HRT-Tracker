import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../contexts/LanguageContext';
import TurnstileModal from '../components/TurnstileModal';
import { TURNSTILE_SITE_KEY } from '../api/config';
import apiClient from '../api/client';
import { Shield, Loader2 } from 'lucide-react';

const Login: React.FC = () => {
  const navigate = useNavigate();
  const { login, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showTurnstileModal, setShowTurnstileModal] = useState(false);
  const isMountedRef = useRef(true);
  const hasNavigatedRef = useRef(false);

  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [registrationDisabled, setRegistrationDisabled] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(false);

  // Redirect if already logged in (only on initial mount)
  useEffect(() => {
    if (isAuthenticated && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;
      navigate('/profile', { replace: true });
    }
  }, [isAuthenticated, navigate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch OIDC config on mount
  useEffect(() => {
    const fetchConfig = async () => {
      const response = await apiClient.getOIDCConfig();
      if (response.success && response.data) {
        setOidcEnabled(response.data.oidc_enabled);
        setRegistrationDisabled(response.data.registration_disabled);
      }
    };
    fetchConfig();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Prevent concurrent submissions
    if (isLoading) return;

    setError('');

    // Trim inputs
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();

    if (!trimmedUsername || !trimmedPassword) {
      setError(t('login.error.emptyFields') || 'Please fill in all fields');
      return;
    }

    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      setError(t('login.error.invalidUsername') || 'Username must be 3-20 characters');
      return;
    }

    if (trimmedPassword.length < 8) {
      setError(t('login.error.invalidPassword') || 'Password must be at least 8 characters');
      return;
    }

    // Check if we need Turnstile verification
    if (import.meta.env.DEV) {
      console.log('[Login] Checking Turnstile requirement...');
      console.log('[Login] TURNSTILE_SITE_KEY:', TURNSTILE_SITE_KEY ? 'Available' : 'Missing');
      console.log('[Login] turnstileToken:', turnstileToken ? 'Has token' : 'No token');
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      if (import.meta.env.DEV) console.log('[Login] Opening Turnstile modal');
      setShowTurnstileModal(true);
      return;
    }

    if (import.meta.env.DEV) console.log('[Login] Proceeding to login');
    await performLogin(trimmedUsername, trimmedPassword);
  };

  const performLogin = async (username: string, password: string, token?: string) => {
    setIsLoading(true);

    try {
      const result = await login(username, password, token || turnstileToken || undefined);

      if (!isMountedRef.current) return;

      if (result.success) {
        hasNavigatedRef.current = true;
        navigate('/', { replace: true });
      } else {
        // If backend says this account uses OIDC, guide user to OIDC login
        if (result.status === 400 && result.error?.toLowerCase().includes('oidc')) {
          setError(t('login.error.oidcBound') || 'This account uses Transmtf login. Please sign in with Transmtf.');
        } else {
          // Generic error message to prevent user enumeration
          setError(t('login.error.failed') || 'Invalid username or password');
        }
        // Reset Turnstile on error
        setTurnstileToken('');
      }
    } catch (error) {
      console.error('Login error:', error);
      if (!isMountedRef.current) return;
      setError(t('login.error.network') || 'Network error. Please try again.');
      // Reset Turnstile on error
      setTurnstileToken('');
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleTurnstileSuccess = (token: string) => {
    if (import.meta.env.DEV) console.log('[Login] Turnstile success, token received');
    setTurnstileToken(token);
    setShowTurnstileModal(false);
    // Auto-submit after verification with the token
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    performLogin(trimmedUsername, trimmedPassword, token);
  };

  const handleTurnstileError = () => {
    if (import.meta.env.DEV) console.error('[Login] Turnstile error');
    setError(t('login.error.captchaFailed') || 'Verification failed. Please try again.');
    setShowTurnstileModal(false);
  };

  const handleOIDCLogin = async () => {
    setOidcLoading(true);
    setError('');
    const response = await apiClient.getOIDCAuthorizeUrl();
    setOidcLoading(false);

    if (response.success && response.data) {
      const { auth_url, state } = response.data;
      sessionStorage.setItem('oidc_state', state);
      sessionStorage.setItem('oidc_action', 'login');
      window.location.href = auth_url;
    } else {
      setError(response.error || t('oidc.callback.error') || 'Failed to start sign-in. Please try again.');
    }
  };

  return (
    <div className="w-full min-h-full flex items-center justify-center p-3 sm:p-4 bg-gradient-to-br from-pink-50 via-white to-blue-50">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-lg p-5 sm:p-6 border border-gray-200">
          <div className="text-center mb-5 sm:mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">
              {t('login.title') || 'Sign In'}
            </h1>
            <p className="text-sm sm:text-base text-gray-600">
              {t('login.subtitle') || 'Welcome back to Transmtf HRT Tracker'}
            </p>
          </div>

          {oidcEnabled && (
            <div className="mb-4 sm:mb-5">
              <button
                type="button"
                onClick={handleOIDCLogin}
                disabled={oidcLoading}
                className="w-full flex items-center justify-center gap-2 border border-gray-300 bg-white text-gray-800 py-2.5 sm:py-3 px-4 rounded-lg sm:rounded-xl font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
              >
                {oidcLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Shield size={18} className="text-blue-500" />
                )}
                {t('oidc.loginButton') || 'Sign in with Transmtf'}
              </button>

              <div className="my-4 flex items-center gap-3">
                <div className="flex-1 border-t border-gray-200" />
                <span className="text-xs text-gray-400">{t('oidc.or') || 'or'}</span>
                <div className="flex-1 border-t border-gray-200" />
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('login.username') || 'Username'}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base border border-gray-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                placeholder={t('login.usernamePlaceholder') || 'Enter your username'}
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('login.password') || 'Password'}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base border border-gray-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                placeholder={t('login.passwordPlaceholder') || 'Enter your password'}
                disabled={isLoading}
              />
            </div>

            {turnstileToken && (
              <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm flex items-center gap-2">
                <Shield size={16} />
                <span>Verification completed</span>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 sm:px-4 sm:py-2.5 rounded-lg sm:rounded-xl text-xs sm:text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-gray-900 text-white py-2.5 sm:py-3 px-4 rounded-lg sm:rounded-xl font-medium hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
            >
              {isLoading ? (t('login.loading') || 'Signing in...') : (t('login.submit') || 'Sign In')}
            </button>
          </form>

          {!registrationDisabled && (
            <div className="mt-4 sm:mt-5 text-center">
              <p className="text-xs sm:text-sm text-gray-600">
                {t('login.noAccount') || "Don't have an account?"}{' '}
                <Link to="/register" className="text-pink-600 hover:text-pink-700 font-medium transition">
                  {t('login.register') || 'Sign Up'}
                </Link>
              </p>
            </div>
          )}

          {registrationDisabled && (
            <div className="mt-4 sm:mt-5 text-center">
              <p className="text-xs sm:text-sm text-gray-500">
                {oidcEnabled
                  ? (t('oidc.registrationDisabled') || 'Registration is disabled. Please sign in with Transmtf.')
                  : (t('register.disabledDesc') || 'New account registration is currently disabled.')}
              </p>
            </div>
          )}

          <div className="mt-3 sm:mt-4 text-center">
            <Link to="/" className="text-gray-500 hover:text-gray-700 text-xs sm:text-sm transition">
              {t('login.continueWithout') || 'Continue without account'}
            </Link>
          </div>
        </div>

        <TurnstileModal
          isOpen={showTurnstileModal}
          onClose={() => setShowTurnstileModal(false)}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          action="login"
          title={t('login.verification') || 'Security Verification'}
          description={t('login.verificationDesc') || 'Please complete the verification to sign in'}
        />
      </div>
    </div>
  );
};

export default Login;
