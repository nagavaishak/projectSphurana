import { useRouterState } from '@tanstack/react-router';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/utils';

interface SidePanelContextValue {
  /** Open the panel with the given content (replaces any current content). */
  open: (content: ReactNode) => void;
  /** Close the panel. */
  close: () => void;
  isOpen: boolean;
}

const SidePanelContext = createContext<SidePanelContextValue | null>(null);
const SidePanelContentContext = createContext<ReactNode | null>(null);

/**
 * Controls the global, non-modal detail panel that docks to the right of the
 * dashboard content. Opening it reflows (shrinks) the page rather than covering
 * it with a backdrop. Call `open(<YourPanelBody/>)` from anywhere under the
 * provider; the body can call `close()` (also via this hook) when done.
 */
export function useSidePanel(): SidePanelContextValue {
  const ctx = useContext(SidePanelContext);
  if (!ctx) {
    throw new Error('useSidePanel must be used within a SidePanelProvider');
  }
  return ctx;
}

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<ReactNode | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = useCallback((node: ReactNode) => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setContent(node);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // Keep content mounted until the slide-out finishes, then drop it so any
    // queries/forms inside unmount.
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setContent(null), 200);
  }, []);

  useEffect(() => {
    return () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };
  }, []);

  // Close on route change — the panel content (and any injected callbacks) is
  // page-scoped, so it shouldn't linger across navigations.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const prevPathname = useRef(pathname);
  useEffect(() => {
    if (prevPathname.current !== pathname) {
      prevPathname.current = pathname;
      close();
    }
  }, [pathname, close]);

  // Escape closes the panel (it has no backdrop to click away on).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, close]);

  const value = useMemo(() => ({ open, close, isOpen }), [open, close, isOpen]);

  return (
    <SidePanelContext.Provider value={value}>
      <SidePanelContentContext.Provider value={content}>
        {children}
      </SidePanelContentContext.Provider>
    </SidePanelContext.Provider>
  );
}

/**
 * Lays out the page content next to the docked panel. The content shifts left
 * (its right padding grows) while the panel slides in via a GPU transform — so
 * there's no backdrop, no page-height change, and no per-frame row reflow.
 * Desktop only: the panel is hidden below `md` (mobile uses full-page routes).
 */
export function SidePanelLayout({ children }: { children: ReactNode }) {
  const { isOpen } = useSidePanel();
  const content = useContext(SidePanelContentContext);

  return (
    <div className="relative flex min-h-0 w-full min-w-0 flex-1">
      <div
        className={cn(
          // min-h-0 lets full-height routes (e.g. conversations) shrink to the
          // viewport so their inner scroll areas scroll instead of being
          // clipped by the overflow-hidden inset.
          'flex min-h-0 min-w-0 flex-1 flex-col transition-[padding] duration-200 ease-out',
          isOpen && 'md:pr-[28rem]'
        )}
      >
        {children}
      </div>
      <aside
        data-testid="side-panel"
        data-state={isOpen ? 'open' : 'closed'}
        aria-hidden={!isOpen}
        className={cn(
          'fixed inset-y-0 right-0 z-30 flex w-full flex-col border-l bg-background shadow-xl transition-transform duration-200 ease-out md:top-(--header-height) md:h-[calc(100svh-var(--header-height))] md:w-[28rem] md:max-w-[90vw]',
          isOpen ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {content}
      </aside>
    </div>
  );
}
