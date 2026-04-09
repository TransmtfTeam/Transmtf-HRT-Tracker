const DEFAULT_API_BASE_URL = 'https://hrt-service.transmtf.com/api';
const FALLBACK_TURNSTILE_SITE_KEY = '0x4AAAAAACNK04dmEz0g0aG7';

type RuntimeEnv = {
  VITE_API_BASE_URL?: string;
  VITE_TURNSTILE_SITE_KEY?: string;
  __ENV__?: {
    VITE_API_BASE_URL?: string;
    VITE_TURNSTILE_SITE_KEY?: string;
  };
};

const runtimeEnv = globalThis as RuntimeEnv;

export const API_BASE_URL =
  runtimeEnv.__ENV__?.VITE_API_BASE_URL ||
  runtimeEnv.VITE_API_BASE_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  DEFAULT_API_BASE_URL;

export const API_ORIGIN = API_BASE_URL.replace(/\/api\/?$/, '');

export const TURNSTILE_SITE_KEY =
  runtimeEnv.__ENV__?.VITE_TURNSTILE_SITE_KEY ||
  runtimeEnv.VITE_TURNSTILE_SITE_KEY ||
  import.meta.env.VITE_TURNSTILE_SITE_KEY ||
  FALLBACK_TURNSTILE_SITE_KEY;

// Log configuration for debugging (only in development)
if (import.meta.env.DEV) {
  console.log('[Config] API_BASE_URL:', API_BASE_URL);
  console.log('[Config] API_BASE_URL Protocol:', API_BASE_URL.startsWith('https://') ? 'HTTPS ✓' : 'HTTP ✗');
  console.log('[Config] TURNSTILE_SITE_KEY:', TURNSTILE_SITE_KEY ? 'Configured' : 'Missing');
  console.log('[Config] Source:',
    runtimeEnv.__ENV__?.VITE_API_BASE_URL ? 'window.__ENV__' :
    runtimeEnv.VITE_API_BASE_URL ? 'globalThis' :
    import.meta.env.VITE_API_BASE_URL ? 'import.meta.env' :
    'Fallback hardcoded');
}
