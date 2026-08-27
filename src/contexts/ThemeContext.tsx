import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

// ─── Theme color presets ───
export type ThemeColorId =
  | 'sakura' | 'ocean' | 'lavender' | 'mint' | 'sunset'
  | 'berry' | 'coral' | 'sky' | 'rose' | 'teal';
export type ThemeMode = 'system' | 'light' | 'dark';

export const THEME_MODE_KEY = 'hrt-theme-mode';

const isThemeMode = (value: string | null): value is ThemeMode =>
  value === 'system' || value === 'light' || value === 'dark';

interface ColorScale {
  50: string; 100: string; 200: string; 300: string;
  400: string; 500: string; 600: string;
}

export const THEME_PRESETS: Record<ThemeColorId, { zh: string; en: string; colors: ColorScale }> = {
  sakura:   { zh: '樱花粉', en: 'Sakura',   colors: { 50:'#fff1f2', 100:'#ffe4e6', 200:'#fecdd3', 300:'#fda4af', 400:'#fb7185', 500:'#f43f5e', 600:'#e11d48' } },
  ocean:    { zh: '海洋蓝', en: 'Ocean',    colors: { 50:'#f0f9ff', 100:'#e0f2fe', 200:'#bae6fd', 300:'#7dd3fc', 400:'#38bdf8', 500:'#0ea5e9', 600:'#0284c7' } },
  lavender: { zh: '薰衣草', en: 'Lavender', colors: { 50:'#f5f3ff', 100:'#ede9fe', 200:'#ddd6fe', 300:'#c4b5fd', 400:'#a78bfa', 500:'#8b5cf6', 600:'#7c3aed' } },
  mint:     { zh: '薄荷绿', en: 'Mint',     colors: { 50:'#ecfdf5', 100:'#d1fae5', 200:'#a7f3d0', 300:'#6ee7b7', 400:'#34d399', 500:'#10b981', 600:'#059669' } },
  sunset:   { zh: '日落橙', en: 'Sunset',   colors: { 50:'#fff7ed', 100:'#ffedd5', 200:'#fed7aa', 300:'#fdba74', 400:'#fb923c', 500:'#f97316', 600:'#ea580c' } },
  berry:    { zh: '浆果紫', en: 'Berry',    colors: { 50:'#fdf4ff', 100:'#fae8ff', 200:'#f5d0fe', 300:'#f0abfc', 400:'#e879f9', 500:'#d946ef', 600:'#c026d3' } },
  coral:    { zh: '珊瑚粉', en: 'Coral',    colors: { 50:'#fdf2f8', 100:'#fce7f3', 200:'#fbcfe8', 300:'#f9a8d4', 400:'#f472b6', 500:'#ec4899', 600:'#db2777' } },
  sky:      { zh: '天青色', en: 'Sky Blue',  colors: { 50:'#ecfeff', 100:'#cffafe', 200:'#a5f3fc', 300:'#67e8f9', 400:'#22d3ee', 500:'#06b6d4', 600:'#0891b2' } },
  rose:     { zh: '玫瑰红', en: 'Rose',     colors: { 50:'#fef2f2', 100:'#fee2e2', 200:'#fecaca', 300:'#fca5a5', 400:'#f87171', 500:'#ef4444', 600:'#dc2626' } },
  teal:     { zh: '青碧色', en: 'Teal',     colors: { 50:'#f0fdfa', 100:'#ccfbf1', 200:'#99f6e4', 300:'#5eead4', 400:'#2dd4bf', 500:'#14b8a6', 600:'#0d9488' } },
};

export const THEME_COLOR_IDS = Object.keys(THEME_PRESETS) as ThemeColorId[];

/** Pre-computed accent-500 RGB triplets for rgba(var(--accent-rgb), alpha) usage */
export const ACCENT_RGB_MAP: Record<ThemeColorId, string> = {
  sakura:   '244,63,94',
  ocean:    '14,165,233',
  lavender: '139,92,246',
  mint:     '16,185,129',
  sunset:   '249,115,22',
  berry:    '217,70,239',
  coral:    '236,72,153',
  sky:      '6,182,212',
  rose:     '239,68,68',
  teal:     '20,184,166',
};

// ─── Context ───
interface ThemeContextType {
  themeColor: ThemeColorId;
  setThemeColor: (id: ThemeColorId) => void;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  /** Shorthand: returns CSS var reference, e.g. ac(500) → 'var(--accent-500)' */
  ac: (shade: keyof ColorScale) => string;
  /** Current preset's color scale */
  colors: ColorScale;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export const useTheme = () => {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
};

// ─── Provider ───
export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [themeColor, setThemeColorState] = useState<ThemeColorId>(() => {
    const saved = localStorage.getItem('hrt-theme-color');
    return (saved && saved in THEME_PRESETS) ? saved as ThemeColorId : 'sakura';
  });

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => {
    const savedMode = localStorage.getItem(THEME_MODE_KEY);
    if (isThemeMode(savedMode)) return savedMode;
    const legacyDark = localStorage.getItem('hrt-dark-mode');
    return legacyDark === '1' || legacyDark === 'true' ? 'dark' : 'light';
  });
  const [systemIsDark, setSystemIsDark] = useState(() =>
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const isDark = themeMode === 'system' ? systemIsDark : themeMode === 'dark';

  // Track whether the change came from cloud/cross-tab to avoid re-triggering sync
  const isExternalThemeUpdate = React.useRef(false);
  const isExternalModeUpdate = React.useRef(false);
  const isInitialTheme = React.useRef(true);
  const isInitialMode = React.useRef(true);

  const colors = THEME_PRESETS[themeColor].colors;

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    const root = document.documentElement;
    const c = THEME_PRESETS[themeColor].colors;
    root.style.setProperty('--accent-50', c[50]);
    root.style.setProperty('--accent-100', c[100]);
    root.style.setProperty('--accent-200', c[200]);
    root.style.setProperty('--accent-300', c[300]);
    root.style.setProperty('--accent-400', c[400]);
    root.style.setProperty('--accent-500', c[500]);
    root.style.setProperty('--accent-600', c[600]);
    root.style.setProperty('--accent-rgb', ACCENT_RGB_MAP[themeColor]);
  }, [themeColor]);

  // Apply dark mode class
  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (event: MediaQueryListEvent) => setSystemIsDark(event.matches);
    setSystemIsDark(media.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  // Persist & notify cloud sync (skip on initial mount and external updates)
  useEffect(() => {
    if (isInitialTheme.current) {
      isInitialTheme.current = false;
      return;
    }
    localStorage.setItem('hrt-theme-color', themeColor);
    if (isExternalThemeUpdate.current) {
      isExternalThemeUpdate.current = false;
      return;
    }
    const now = new Date().toISOString();
    localStorage.setItem('hrt-last-modified', now);
    localStorage.setItem('hrt-last-data-updated', now);
    window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: 'hrt-theme-color' } }));
  }, [themeColor]);
  useEffect(() => {
    if (isInitialMode.current) {
      isInitialMode.current = false;
      return;
    }
    localStorage.setItem(THEME_MODE_KEY, themeMode);
    // Keep the legacy field current for older clients and cloud snapshots.
    localStorage.setItem('hrt-dark-mode', isDark ? '1' : '0');
    if (isExternalModeUpdate.current) {
      isExternalModeUpdate.current = false;
      return;
    }
    const now = new Date().toISOString();
    localStorage.setItem('hrt-last-modified', now);
    localStorage.setItem('hrt-last-data-updated', now);
    window.dispatchEvent(new CustomEvent('hrt-local-data-updated', { detail: { key: THEME_MODE_KEY } }));
  }, [themeMode]);

  // Listen for storage changes (cross-tab / cloud sync)
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === 'hrt-theme-color' && e.newValue && e.newValue in THEME_PRESETS) {
        isExternalThemeUpdate.current = true;
        setThemeColorState(e.newValue as ThemeColorId);
      }
      if (e.key === THEME_MODE_KEY && isThemeMode(e.newValue)) {
        isExternalModeUpdate.current = true;
        setThemeModeState(e.newValue);
      } else if (e.key === 'hrt-dark-mode' && !localStorage.getItem(THEME_MODE_KEY)) {
        isExternalModeUpdate.current = true;
        setThemeModeState(e.newValue === '1' || e.newValue === 'true' ? 'dark' : 'light');
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const setThemeColor = useCallback((id: ThemeColorId) => {
    setThemeColorState(id);
  }, []);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
  }, []);

  const ac = useCallback((shade: keyof ColorScale) => `var(--accent-${shade})`, []);

  const value = useMemo(() => ({
    themeColor, setThemeColor, isDark, themeMode, setThemeMode, ac, colors,
  }), [themeColor, setThemeColor, isDark, themeMode, setThemeMode, ac, colors]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};
