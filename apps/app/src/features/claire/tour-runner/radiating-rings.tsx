import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

interface RadiatingRingsProps {
  target: Element;
  /** Extra padding added around the target rect in px. Default 6. */
  padding?: number;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function rectFor(el: Element, padding: number): Rect {
  const r = el.getBoundingClientRect();
  return {
    top: r.top - padding,
    left: r.left - padding,
    width: r.width + padding * 2,
    height: r.height + padding * 2,
  };
}

/**
 * Pulsing radiating rings overlay placed on top of the active tour target.
 *
 * Non-interactive (pointer-events: none) so the user can still click through
 * to the spotlighted element — the click lands on the real target, the tour
 * runner picks it up via its own listener, and the step advances.
 */
export function RadiatingRings({ target, padding = 6 }: RadiatingRingsProps) {
  const [rect, setRect] = useState<Rect>(() => rectFor(target, padding));

  useEffect(() => {
    const update = () => setRect(rectFor(target, padding));
    update();

    const ro = new ResizeObserver(update);
    ro.observe(target);
    // Also observe the body so that layout shifts reposition us.
    if (document.body) ro.observe(document.body);

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target, padding]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[100000]"
      style={{
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      }}
    >
      <span
        className={cn(
          'absolute inset-0 rounded-md',
          'ring-2 ring-primary/70',
          'animate-[ping_1.6s_cubic-bezier(0,0,0.2,1)_infinite]'
        )}
      />
      <span
        className={cn(
          'absolute inset-0 rounded-md',
          'ring-2 ring-primary',
          'opacity-90'
        )}
      />
    </div>,
    document.body
  );
}
