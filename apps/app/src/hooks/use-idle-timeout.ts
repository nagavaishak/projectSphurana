import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes — matches apps/web

export function useIdleTimeout() {
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const reset = () => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void navigate({ to: '/sign-in', search: { reason: 'idle' } });
      }, IDLE_TIMEOUT_MS);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'] as const;
    for (const e of events) {
      window.addEventListener(e, reset, { passive: true });
    }
    reset();

    return () => {
      for (const e of events) {
        window.removeEventListener(e, reset);
      }
      clearTimeout(timerRef.current);
    };
  }, [navigate]);
}
