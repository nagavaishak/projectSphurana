import { cn } from '@/lib/utils';

// Frosted glass needs a translucent *tint* — not `bg-transparent`. iOS
// WKWebView frequently fails to composite `backdrop-filter` on fixed
// elements, and with no tint the surface then renders fully see-through.
// `bg-white/85` is the no-backdrop-filter fallback; `bg-white/70` is the
// tint used when the blur does render, so it still reads as glass.
export const glassBlurClass =
  'bg-white/85 backdrop-blur-md backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70';

export const glassButtonClass = cn(
  'overflow-hidden border border-white/80',
  glassBlurClass,
  'shadow-[0_10px_32px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]',
  'ring-1 ring-inset ring-white/90'
);

/** Glass controls (header icons, tab triggers) — no focus ring halo. */
export const glassInteractiveClass = cn(
  glassButtonClass,
  'outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
);

/** Smooth ease-out — gentle start, soft landing (no overshoot). */
export const mobileNavEase = 'cubic-bezier(0.32, 0.72, 0, 1)';

export const mobileNavDurationMs = 480;

export const mobileNavFlexTransition = `flex ${mobileNavDurationMs}ms ${mobileNavEase}`;

export const mobileNavFadeClass =
  'motion-reduce:transition-none motion-reduce:delay-0';

/** Build transition with optional delay (ms). */
export function mobileNavTransition(properties: string, delayMs = 0): string {
  return `${properties} ${mobileNavDurationMs}ms ${mobileNavEase} ${delayMs}ms`;
}
