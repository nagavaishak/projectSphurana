'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

/**
 * Two route animations, deliberately different in weight.
 *
 * `FunnelTransition` covers the BIG move: leaving the app for a create/edit
 * editor and coming back. Those swap the entire screen, so they cross-fade —
 * old zone out, new zone in — and the `zone` key is coarse (app / editor /
 * assistant) so that navigating *within* the dashboard does NOT unmount the
 * sidebar, header and providers on every click.
 *
 * `PageTransition` covers the small move: one dashboard page to the next. It is
 * enter-only (there is nothing to fade out — the outgoing page is already gone
 * by the time the new one mounts) and rides on `tw-animate-css` utilities so it
 * costs no JS.
 *
 * Both are OPACITY-first. A transform on a wrapper this high in the tree would
 * make it the containing block for every `position: fixed` descendant — the
 * sidebar, the mobile tab bar, the side panel — and slide them with the page.
 */

/** Coarse zone for a pathname. Same zone → no cross-fade, no remount. */
export function routeZone(pathname: string): string {
  if (pathname.startsWith('/create/') || pathname.startsWith('/edit/')) {
    return 'editor';
  }
  if (pathname.startsWith('/assistant')) return 'assistant';
  return 'app';
}

export function FunnelTransition({
  zone,
  children,
}: {
  zone: string;
  children: ReactNode;
}) {
  const reduced = useReducedMotion();

  if (reduced) return <>{children}</>;

  return (
    <AnimatePresence initial={false} mode="wait">
      <motion.div
        animate={{ opacity: 1 }}
        // A definite min-height so a full-height child (the editor's
        // `md:h-svh`, the dashboard shell) still has a viewport to fill while
        // the outgoing zone is unmounting.
        className="min-h-svh"
        exit={{ opacity: 0 }}
        initial={{ opacity: 0 }}
        key={zone}
        transition={{ duration: 0.16, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

/**
 * Enter animation for a dashboard page. Wrap the router outlet and key it on
 * the pathname so the animation replays on every navigation.
 *
 * The wrapper repeats its parent's flex classes on purpose: the dashboard inset
 * is a flex column that full-height routes (calendar, inbox) shrink inside, and
 * a plain `<div>` here would break that chain.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <div
      className="fade-in slide-in-from-bottom-1 flex min-h-0 min-w-0 flex-1 animate-in flex-col duration-200 ease-out motion-reduce:animate-none"
      data-route-transition=""
    >
      {children}
    </div>
  );
}
