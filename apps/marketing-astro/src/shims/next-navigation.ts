// Shim for `next/navigation`. The Astro site uses full page loads (no SPA
// router), so these read directly from `window.location`.
import { useMemo } from 'react';

export function usePathname(): string {
  if (typeof window === 'undefined') return '/';
  return window.location.pathname;
}

export function useSearchParams(): URLSearchParams {
  // Memoised so consumers can safely use it as an effect dependency.
  return useMemo(() => {
    if (typeof window === 'undefined') return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, []);
}

export function useRouter() {
  return {
    push: (href: string) => window.location.assign(href),
    replace: (href: string) => window.location.replace(href),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    refresh: () => window.location.reload(),
    prefetch: () => {},
  };
}

export function notFound(): never {
  throw new Error('NEXT_NOT_FOUND');
}

export function redirect(url: string): never {
  if (typeof window !== 'undefined') window.location.assign(url);
  throw new Error('NEXT_REDIRECT');
}
