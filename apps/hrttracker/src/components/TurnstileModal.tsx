import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { TURNSTILE_SITE_KEY } from '../api/config';

// Declare Turnstile types for the global window object
declare global {
  interface Window {
    turnstile?: {
      render: (element: string | HTMLElement, options: {
        sitekey: string;
        action?: string;
        cData?: string;
        callback?: (token: string) => void;
        'error-callback'?: () => void;
        'expired-callback'?: () => void;
      }) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

interface TurnstileModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
  onError?: () => void;
  action?: string;
  title?: string;
  description?: string;
}

const TurnstileModal: React.FC<TurnstileModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onError,
  action,
  title = 'Security Verification',
  description = 'Please complete the verification to continue',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);

  // Update refs when callbacks change
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
  }, [onSuccess, onError]);

  // Get site key from centralized config
  const getSiteKey = (): string => {
    const siteKey = TURNSTILE_SITE_KEY || '';

    if (import.meta.env.DEV) {
      console.log('[TurnstileModal] Site key from config:', siteKey ? 'Found' : 'Not found');
      console.log('[TurnstileModal] window.__ENV__:', (globalThis as any).__ENV__);
    }

    return siteKey;
  };

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onClose]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Load Turnstile script dynamically if not present
  useEffect(() => {
    if (!isOpen) return;

    const loadTurnstileScript = () => {
      return new Promise<void>((resolve, reject) => {
        if (window.turnstile) {
          if (import.meta.env.DEV) console.log('[TurnstileModal] Turnstile already loaded');
          resolve();
          return;
        }

        const existingScript = document.querySelector('script[src*="challenges.cloudflare.com/turnstile"]');
        if (existingScript) {
          if (import.meta.env.DEV) console.log('[TurnstileModal] Turnstile script already in DOM, waiting...');
          const checkInterval = setInterval(() => {
            if (window.turnstile) {
              clearInterval(checkInterval);
              resolve();
            }
          }, 100);
          setTimeout(() => {
            clearInterval(checkInterval);
            if (!window.turnstile) {
              reject(new Error('Turnstile script timeout'));
            }
          }, 10000);
          return;
        }

        if (import.meta.env.DEV) console.log('[TurnstileModal] Loading Turnstile script...');
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          if (import.meta.env.DEV) console.log('[TurnstileModal] Turnstile script loaded');
          // Wait a bit for the API to initialize
          setTimeout(() => {
            if (window.turnstile) {
              resolve();
            } else {
              reject(new Error('Turnstile API not available after load'));
            }
          }, 100);
        };
        script.onerror = () => {
          console.error('[TurnstileModal] Failed to load Turnstile script');
          reject(new Error('Failed to load Turnstile script'));
        };
        document.head.appendChild(script);
      });
    };

    const renderTurnstile = async () => {
      try {
        const siteKey = getSiteKey();

        if (!siteKey) {
          console.error('[TurnstileModal] No site key available');
          onErrorRef.current?.();
          return;
        }

        await loadTurnstileScript();

        if (!containerRef.current || widgetIdRef.current) {
          return;
        }

        if (import.meta.env.DEV) console.log('[TurnstileModal] Rendering Turnstile widget...');
        widgetIdRef.current = window.turnstile!.render(containerRef.current, {
          sitekey: siteKey,
          action,
          callback: (token: string) => {
            if (import.meta.env.DEV) console.log('[TurnstileModal] Verification successful');
            onSuccessRef.current(token);
          },
          'error-callback': () => {
            console.error('[TurnstileModal] Verification error');
            onErrorRef.current?.();
            if (widgetIdRef.current && window.turnstile) {
              window.turnstile.reset(widgetIdRef.current);
            }
          },
          'expired-callback': () => {
            if (import.meta.env.DEV) console.warn('[TurnstileModal] Verification expired');
            onErrorRef.current?.();
            if (widgetIdRef.current && window.turnstile) {
              window.turnstile.reset(widgetIdRef.current);
            }
          },
        });
        if (import.meta.env.DEV) console.log('[TurnstileModal] Widget rendered with ID:', widgetIdRef.current);
      } catch (error) {
        console.error('[TurnstileModal] Failed to render:', error);
        onErrorRef.current?.();
      }
    };

    renderTurnstile();

    return () => {
      if (widgetIdRef.current && window.turnstile) {
        try {
          if (import.meta.env.DEV) console.log('[TurnstileModal] Removing widget:', widgetIdRef.current);
          window.turnstile.remove(widgetIdRef.current);
        } catch (error) {
          console.error('[TurnstileModal] Failed to remove widget:', error);
        }
        widgetIdRef.current = null;
      }
    };
  }, [isOpen, action]);

  if (!isOpen) {
    return null;
  }

  if (import.meta.env.DEV) console.log('[TurnstileModal] Rendering modal - isOpen:', isOpen);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-in slide-in-from-bottom">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-600 mt-1">{description}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition p-1 rounded-lg hover:bg-gray-100"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex justify-center py-4">
          <div ref={containerRef} className="flex justify-center" />
        </div>

        <div className="mt-4 text-center text-xs text-gray-500">
          Protected by Cloudflare Turnstile
        </div>
      </div>
    </div>
  );
};

export default TurnstileModal;
