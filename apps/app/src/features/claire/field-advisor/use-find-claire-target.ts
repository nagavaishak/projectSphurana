import { useEffect, useState } from 'react';

const POLL_INTERVAL_MS = 200;

/**
 * Polls the DOM for an element matching `data-claire-target="${selector}"` and
 * returns it once present. Uses a MutationObserver so we react instantly when
 * the wizard step mounts.
 */
export function useFindClaireTarget(
  targetSelector: string | null
): Element | null {
  const [target, setTarget] = useState<Element | null>(null);

  useEffect(() => {
    if (!targetSelector) {
      setTarget(null);
      return;
    }
    const selector = `[data-claire-target="${targetSelector}"]`;
    let cancelled = false;

    const lookup = () => {
      if (cancelled) return false;
      const el = document.querySelector(selector);
      if (el) {
        setTarget((prev) => (prev === el ? prev : el));
        return true;
      }
      setTarget(null);
      return false;
    };

    if (lookup()) {
      // Already present — still watch for it being removed/replaced.
    }

    const observer = new MutationObserver(() => {
      lookup();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const intervalId = window.setInterval(lookup, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.clearInterval(intervalId);
    };
  }, [targetSelector]);

  return target;
}
