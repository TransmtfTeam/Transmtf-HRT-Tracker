import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from '../contexts/LanguageContext';
import TurnstileModal from '../components/TurnstileModal';
import { TURNSTILE_SITE_KEY } from '../api/config';
import apiClient from '../api/client';
import { Shield, Loader2 } from 'lucide-react';

const Register: React.FC = () => {
  const navigate = useNavigate();
  const { register, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [showTurnstileModal, setShowTurnstileModal] = useState(false);
  const isMountedRef = useRef(true);
  const hasNavigatedRef = useRef(false);

  const [registrationDisabled, setRegistrationDisabled] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
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
        setRegistrationDisabled(response.data.registration_disabled);
        setOidcEnabled(response.data.oidc_enabled);
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
    const trimmedConfirmPassword = confirmPassword.trim();

    if (!trimmedUsername || !trimmedPassword || !trimmedConfirmPassword) {
      setError(t('register.error.emptyFields') || 'Please fill in all fields');
      return;
    }

    if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
      setError(t('register.error.invalidUsername') || 'Username must be 3-20 characters');
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      setError(
        t('register.error.usernameFormat') || 'Username can only contain letters, numbers, and underscores'
      );
      return;
    }

    if (trimmedPassword.length < 8) {
      setError(t('register.error.invalidPassword') || 'Password must be at least 8 characters');
      return;
    }

    // Check password complexity
    const hasLetter = /[a-zA-Z]/.test(trimmedPassword);
    const hasNumber = /[0-9]/.test(trimmedPassword);
    if (!hasLetter || !hasNumber) {
      setError(t('register.error.passwordComplexity') || 'Password must contain both letters and numbers');
      return;
    }

    if (trimmedPassword !== trimmedConfirmPassword) {
      setError(t('register.error.passwordMismatch') || 'Passwords do not match');
      return;
    }

    // Check if we need Turnstile verification
    if (import.meta.env.DEV) {
      console.log('[Register] Checking Turnstile requirement...');
      console.log('[Register] TURNSTILE_SITE_KEY:', TURNSTILE_SITE_KEY ? 'Available' : 'Missing');
      console.log('[Register] turnstileToken:', turnstileToken ? 'Has token' : 'No token');
    }

    if (TURNSTILE_SITE_KEY && !turnstileToken) {
      if (import.meta.env.DEV) console.log('[Register] Opening Turnstile modal');
      setShowTurnstileModal(true);
      return;
    }

    if (import.meta.env.DEV) console.log('[Register] Proceeding to register');
    await performRegister(trimmedUsername, trimmedPassword);
  };

  const performRegister = async (username: string, password: string, token?: string) => {
    setIsLoading(true);

    try {
      const result = await register(username, password, token || turnstileToken || undefined);

      if (!isMountedRef.current) return;

      if (result.success) {
        hasNavigatedRef.current = true;
        navigate('/', { replace: true });
      } else {
        // Generic error message to prevent information leakage
        setError(t('register.error.failed') || 'Registration failed. Please try a different username.');
        // Reset Turnstile on error
        setTurnstileToken('');
      }
    } catch (error) {
      console.error('Registration error:', error);
      if (!isMountedRef.current) return;
      setError(t('register.error.network') || 'Network error. Please try again.');
      // Reset Turnstile on error
      setTurnstileToken('');
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const handleTurnstileSuccess = (token: string) => {
    if (import.meta.env.DEV) console.log('[Register] Turnstile success, token received');
    setTurnstileToken(token);
    setShowTurnstileModal(false);
    // Auto-submit after verification with the token
    const trimmedUsername = username.trim();
    const trimmedPassword = password.trim();
    performRegister(trimmedUsername, trimmedPassword, token);
  };

  const handleTurnstileError = () => {
    if (import.meta.env.DEV) console.error('[Register] Turnstile error');
    setError(t('register.error.captchaFailed') || 'Verification failed. Please try again.');
    setShowTurnstileModal(false);
  };

  const handleOIDCLogin = async () => {
    setOidcLoading(true);
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

  // If registration is disabled, show a message with OIDC option
  if (registrationDisabled) {
    return (
      <div className="w-full min-h-full flex items-center justify-center p-3 sm:p-4 bg-gradient-to-br from-pink-50 via-white to-blue-50">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl sm:rounded-3xl shadow-lg p-5 sm:p-6 border border-gray-200 text-center">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-2">
              {t('register.disabled') || 'Registration Disabled'}
            </h1>
            <p className="text-sm sm:text-base text-gray-600 mb-6">
              {t('register.disabledDesc') || 'New account registration is currently disabled. Please sign in with Transmtf.'}
            </p>

            {oidcEnabled && (
              <button
                type="button"
                onClick={handleOIDCLogin}
                disabled={oidcLoading}
                className="w-full flex items-center justify-center gap-2 border border-gray-300 bg-white text-gray-800 py-2.5 sm:py-3 px-4 rounded-lg sm:rounded-xl font-medium hover:bg-gray-50 transition disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base mb-4"
              >
                {oidcLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Shield size={18} className="text-blue-500" />
                )}
                {t('oidc.loginButton') || 'Sign in with Transmtf'}
              </button>
            )}

            <Link to="/login" className="text-pink-600 hover:text-pink-700 text-sm font-medium transition">
              {t('register.login') || 'Sign In'}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-full flex items-center justify-center p-3 sm:p-4 bg-gradient-to-br from-pink-50 via-white to-blue-50">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-lg p-5 sm:p-6 border border-gray-200">
          <div className="text-center mb-5 sm:mb-6">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-1 sm:mb-2">
              {t('register.title') || 'Create Account'}
            </h1>
            <p className="text-sm sm:text-base text-gray-600">
              {t('register.subtitle') || 'Join Transmtf HRT Tracker to sync your data'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('register.username') || 'Username'}
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base border border-gray-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                placeholder={t('register.usernamePlaceholder') || '3-20 characters, letters, numbers, and underscores'}
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('register.password') || 'Password'}
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base border border-gray-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                placeholder={t('register.passwordPlaceholder') || 'At least 8 characters with letters and numbers'}
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('register.confirmPassword') || 'Confirm Password'}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-3 py-2 sm:px-4 sm:py-2.5 text-sm sm:text-base border border-gray-300 rounded-lg sm:rounded-xl focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition"
                placeholder={t('register.confirmPasswordPlaceholder') || 'Re-enter your password'}
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
              {isLoading ? (t('register.loading') || 'Creating account...') : (t('register.submit') || 'Create Account')}
            </button>
          </form>

          <div className="mt-4 sm:mt-5 text-center">
            <p className="text-xs sm:text-sm text-gray-600">
              {t('register.hasAccount') || 'Already have an account?'}{' '}
              <Link to="/login" className="text-pink-600 hover:text-pink-700 font-medium transition">
                {t('register.login') || 'Sign In'}
              </Link>
            </p>
          </div>

          <div className="mt-3 sm:mt-4 text-center">
            <Link to="/" className="text-gray-500 hover:text-gray-700 text-xs sm:text-sm transition">
              {t('register.continueWithout') || 'Continue without account'}
            </Link>
          </div>
        </div>

        <TurnstileModal
          isOpen={showTurnstileModal}
          onClose={() => setShowTurnstileModal(false)}
          onSuccess={handleTurnstileSuccess}
          onError={handleTurnstileError}
          action="register"
          title={t('register.verification') || 'Security Verification'}
          description={t('register.verificationDesc') || 'Please complete the verification to create account'}
        />
      </div>
    </div>
  );
};

export default Register;
