import React, { useEffect, useRef } from 'react';
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

interface TurnstileProps {
  onSuccess: (token: string) => void;
  onError?: () => void;
  onExpired?: () => void;
  action?: string;
  cData?: string;
}

const Turnstile: React.FC<TurnstileProps> = ({ onSuccess, onError, onExpired, action, cData }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  // Use refs to store latest callbacks to avoid closure issues
  const onSuccessRef = useRef(onSuccess);
  const onErrorRef = useRef(onError);
  const onExpiredRef = useRef(onExpired);

  // Update refs when callbacks change
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onErrorRef.current = onError;
    onExpiredRef.current = onExpired;
  }, [onSuccess, onError, onExpired]);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) {
      console.warn('Turnstile site key is not configured');
      return;
    }

    let checkInterval: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let isRendered = false;

    const renderTurnstile = () => {
      if (containerRef.current && window.turnstile && !widgetIdRef.current && !isRendered) {
        try {
          widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            action,
            cData,
            callback: (token: string) => {
              onSuccessRef.current(token);
            },
            'error-callback': () => {
              onErrorRef.current?.();
              if (widgetIdRef.current && window.turnstile) {
                window.turnstile.reset(widgetIdRef.current);
              }
            },
            'expired-callback': () => {
              if (onExpiredRef.current) {
                onExpiredRef.current();
              }
              if (widgetIdRef.current && window.turnstile) {
                window.turnstile.reset(widgetIdRef.current);
              }
            },
          });
          // Only set isRendered to true after successful render
          isRendered = true;
        } catch (error) {
          console.error('Failed to render Turnstile:', error);
          isRendered = false; // Reset flag on error to allow retry
          onErrorRef.current?.();
        }
      }
    };

    // Wait for Turnstile script to load
    if (window.turnstile) {
      renderTurnstile();
    } else {
      checkInterval = setInterval(() => {
        if (window.turnstile) {
          if (checkInterval) clearInterval(checkInterval);
          renderTurnstile();
        }
      }, 100);

      // Cleanup interval after 10 seconds and show error
      timeoutId = setTimeout(() => {
        if (checkInterval) clearInterval(checkInterval);
        if (!isRendered) {
          console.error('Turnstile script failed to load within 10 seconds');
          onErrorRef.current?.();
        }
      }, 10000);
    }

    return () => {
      // Clean up interval and timeout
      if (checkInterval) clearInterval(checkInterval);
      if (timeoutId) clearTimeout(timeoutId);

      // Remove widget
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (error) {
          console.error('Failed to remove Turnstile widget:', error);
        }
        widgetIdRef.current = null;
      }
    };
  }, []); // Empty deps - only run once on mount

  // Don't render if site key is not configured
  if (!TURNSTILE_SITE_KEY) {
    return null;
  }

  return <div ref={containerRef} className="flex justify-center" />;
};

export default Turnstile;

// Export a helper function to reset Turnstile
export const resetTurnstile = (widgetId?: string) => {
  if (window.turnstile) {
    window.turnstile.reset(widgetId);
  }
};
