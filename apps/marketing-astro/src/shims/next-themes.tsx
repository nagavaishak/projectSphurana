// Shim for `next-themes`. A compact, API-compatible theme provider so the
// ported ThemeProvider / ModeToggle / Sonner components work unchanged —
// without the next-themes dependency. The pre-paint theme class is applied
// by an inline script in BaseLayout.astro; this keeps React state in sync.
'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export interface ThemeProviderProps {
  children?: ReactNode;
  attribute?: string | string[];
  defaultTheme?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  storageKey?: string;
  /**
   * Pin the theme and ignore both the stored preference and the OS.
   *
   * Tenant surfaces (booking, venue, the customer portal) set this: they are a
   * clinic's public pages and are always light. The prop was previously
   * swallowed by the `[key: string]: unknown` catch-all, so passing it did
   * nothing — the provider still resolved "system" on hydration and put
   * `.dark` back on <html>, undoing the light class the layout had already
   * rendered. Matching next-themes here means `useTheme()` consumers (Sonner)
   * also see the forced value rather than the OS one.
   */
  forcedTheme?: string;
  [key: string]: unknown;
}

interface ThemeContextValue {
  theme: string | undefined;
  setTheme: (theme: string) => void;
  resolvedTheme: 'light' | 'dark' | undefined;
  systemTheme: 'light' | 'dark' | undefined;
  themes: string[];
}

const STORAGE_KEY = 'theme';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function applyTheme(resolved: 'light' | 'dark') {
  const el = document.documentElement;
  el.classList.remove('light', 'dark');
  el.classList.add(resolved);
  el.style.colorScheme = resolved;
}

export function ThemeProvider({
  children,
  defaultTheme = 'system',
  storageKey = STORAGE_KEY,
  forcedTheme,
}: ThemeProviderProps) {
  // Start from defaultTheme on both server and client so the first render
  // matches; the stored value is read in an effect after hydration.
  const [theme, setThemeState] = useState<string>(forcedTheme ?? defaultTheme);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    // A forced theme ignores the OS and the stored preference outright, so
    // there is nothing to read and no media query worth subscribing to.
    if (forcedTheme) return;

    setSystemTheme(getSystemTheme());
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) setThemeState(stored);
    } catch {
      /* localStorage unavailable */
    }

    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemTheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [storageKey, forcedTheme]);

  const active = forcedTheme ?? theme;
  const resolvedTheme: 'light' | 'dark' =
    active === 'system' ? systemTheme : active === 'dark' ? 'dark' : 'light';

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setTheme = useCallback(
    (next: string) => {
      // next-themes ignores setTheme while a theme is forced.
      if (forcedTheme) return;
      setThemeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        /* localStorage unavailable */
      }
    },
    [storageKey, forcedTheme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme: active,
      setTheme,
      resolvedTheme,
      systemTheme,
      themes: ['light', 'dark', 'system'],
    }),
    [active, setTheme, resolvedTheme, systemTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (ctx) return ctx;
  return {
    theme: undefined,
    setTheme: () => {},
    resolvedTheme: undefined,
    systemTheme: undefined,
    themes: [],
  };
}
