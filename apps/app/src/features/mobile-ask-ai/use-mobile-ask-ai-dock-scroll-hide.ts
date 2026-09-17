import { useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';

const SCROLL_DELTA = 8;
const TOP_REVEAL_PX = 12;

function scrollTopOf(target: Window | HTMLElement): number {
  if (target instanceof HTMLElement) {
    return target.scrollTop;
  }
  return (
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0
  );
}

/**
 * Hides the mobile Ask AI dock while the user scrolls down / explores content,
 * and reveals it when they scroll up — unless `pinned` (sheet, search, menu).
 */
export function useMobileAskAiDockScrollHide(options: {
  pinned: boolean;
}): boolean {
  const { pinned } = options;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [hidden, setHidden] = useState(false);
  const lastScrollByTarget = useRef(new Map<Window | HTMLElement, number>());
  const touchYRef = useRef<number | null>(null);

  const applyHidden = useCallback(
    (next: boolean) => {
      if (pinned) {
        setHidden(false);
        return;
      }
      setHidden((h) => (h === next ? h : next));
    },
    [pinned]
  );

  useEffect(() => {
    if (pinned) setHidden(false);
  }, [pinned]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname must re-run this effect after SPA navigation (new scroll container + reset dock visibility) even though listeners only close over pinned/applyHidden.
  useEffect(() => {
    setHidden(false);
  }, [pathname]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname must re-run this effect after SPA navigation (new scroll container + reset dock visibility) even though listeners only close over pinned/applyHidden.
  useEffect(() => {
    const scrollTargets: (Window | HTMLElement)[] = [window];
    const inset = document.querySelector<HTMLElement>(
      '[data-mobile-dock-scroll-container]'
    );
    if (inset) scrollTargets.push(inset);

    for (const t of scrollTargets) {
      lastScrollByTarget.current.set(t, scrollTopOf(t));
    }

    const onScroll = (e: Event) => {
      if (pinned) return;
      const current = e.currentTarget;
      const target: Window | HTMLElement =
        current === window ? window : (current as HTMLElement);

      const y = scrollTopOf(target);
      const prev = lastScrollByTarget.current.get(target) ?? y;
      const dy = y - prev;
      if (Math.abs(dy) < SCROLL_DELTA) return;

      if (y <= TOP_REVEAL_PX) applyHidden(false);
      else if (dy > 0) applyHidden(true);
      else applyHidden(false);

      lastScrollByTarget.current.set(target, y);
    };

    const onTouchStart = (e: TouchEvent) => {
      if (pinned || e.touches.length !== 1) return;
      touchYRef.current = e.touches[0].clientY;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (pinned || e.touches.length !== 1) return;
      const y = e.touches[0].clientY;
      const prev = touchYRef.current;
      if (prev == null) return;
      const dy = y - prev;
      if (Math.abs(dy) < SCROLL_DELTA) return;
      if (dy < 0) applyHidden(true);
      else applyHidden(false);
      touchYRef.current = y;
    };

    const onTouchEnd = () => {
      touchYRef.current = null;
    };

    for (const t of scrollTargets) {
      if (t === window) {
        window.addEventListener('scroll', onScroll, { passive: true });
      } else {
        t.addEventListener('scroll', onScroll, { passive: true });
      }
    }
    window.addEventListener('touchstart', onTouchStart, {
      passive: true,
      capture: true,
    });
    window.addEventListener('touchmove', onTouchMove, {
      passive: true,
      capture: true,
    });
    window.addEventListener('touchend', onTouchEnd, {
      passive: true,
      capture: true,
    });

    return () => {
      for (const t of scrollTargets) {
        if (t === window) {
          window.removeEventListener('scroll', onScroll);
        } else {
          t.removeEventListener('scroll', onScroll);
        }
      }
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('touchend', onTouchEnd, true);
    };
  }, [pathname, pinned, applyHidden]);

  return hidden;
}
