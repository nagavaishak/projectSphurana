'use client';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';

export const ModeToggle = () => {
  const { theme, setTheme } = useTheme();

  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const handleChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const switchTheme = () => {
    switch (theme) {
      case 'light': {
        setTheme('dark');
        return;
      }

      case 'dark': {
        setTheme('light');
        return;
      }

      case 'system': {
        setTheme(systemTheme === 'light' ? 'dark' : 'light');
        return;
      }
      default: {
        return;
      }
    }
  };
  return (
    <button
      type="button"
      onClick={switchTheme}
      className="size-4 flex items-center justify-center relative"
      aria-label="Toggle theme"
    >
      <SunIcon
        size={14}
        className="rotate-0 absolute inset-0 scale-100 transition-all duration-200 dark:rotate-90 dark:scale-0"
      />
      <MoonIcon
        size={14}
        className="rotate-90 absolute inset-0 scale-0 transition-all duration-200 dark:rotate-0 dark:scale-100"
      />
    </button>
  );
};
