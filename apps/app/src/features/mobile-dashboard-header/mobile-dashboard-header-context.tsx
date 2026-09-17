import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { areMobileDashboardHeaderContentsEqual } from './mobile-dashboard-header-content-equal';
import type { MobileDashboardHeaderContent } from './mobile-dashboard-header-types';

export type {
  MobileDashboardHeaderAction,
  MobileDashboardHeaderContent,
} from './mobile-dashboard-header-types';

interface MobileDashboardHeaderContextValue {
  content: MobileDashboardHeaderContent;
  setContent: (content: MobileDashboardHeaderContent) => void;
}

const MobileDashboardHeaderContext =
  createContext<MobileDashboardHeaderContextValue | null>(null);

export function MobileDashboardHeaderProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [content, setContentState] = useState<MobileDashboardHeaderContent>({});

  const setContent = useCallback((next: MobileDashboardHeaderContent) => {
    setContentState((prev) =>
      areMobileDashboardHeaderContentsEqual(prev, next) ? prev : next
    );
  }, []);

  const value = useMemo(() => ({ content, setContent }), [content, setContent]);

  return (
    <MobileDashboardHeaderContext.Provider value={value}>
      {children}
    </MobileDashboardHeaderContext.Provider>
  );
}

const noopSetContent = (_next: MobileDashboardHeaderContent) => {};

export function useMobileDashboardHeaderContext() {
  const ctx = useContext(MobileDashboardHeaderContext);
  if (!ctx) {
    throw new Error(
      'useMobileDashboardHeaderContext must be used within MobileDashboardHeaderProvider'
    );
  }
  return ctx;
}

/**
 * Configure the floating mobile dashboard header for the current page.
 * Clears all fields on unmount.
 *
 * The ReactNode fields (`extraActions`, `centerSlot`, `leadingSlot`,
 * `titleSlot`, `rightSlot`) are compared by reference, so callers MUST memoize
 * them — an element rebuilt on every render re-fires this effect forever.
 */
export function useMobileDashboardHeaderContent(
  content: MobileDashboardHeaderContent
) {
  // The OPTIONAL read, not `useMobileDashboardHeaderContext()`.
  //
  // Since `DashboardPage` publishes the header for every page built on the
  // shared shell, this hook now runs inside ~30 components that unit tests
  // render on their own, outside the dashboard layout. Throwing there would
  // fail those tests for a reason that has nothing to do with what they assert.
  //
  // In the app the provider wraps the whole dashboard layout, so "no provider"
  // only ever means "not inside the dashboard" — where there is no floating
  // header to configure and doing nothing is the correct behaviour.
  const setContent =
    useContext(MobileDashboardHeaderContext)?.setContent ?? noopSetContent;

  const {
    heading,
    subheading,
    showBack,
    centerTitle,
    compactTitle,
    centerSlot,
    leadingSlot,
    titleSlot,
    alignItemsTop,
    extraActions,
    hideInbox,
    hideNotifications,
    hideTrailing,
    onBack,
    rightActions,
    rightSlot,
  } = content;

  useEffect(() => {
    setContent({
      heading,
      subheading,
      showBack,
      centerTitle,
      compactTitle,
      centerSlot,
      leadingSlot,
      titleSlot,
      alignItemsTop,
      extraActions,
      hideInbox,
      hideNotifications,
      hideTrailing,
      onBack,
      rightActions,
      rightSlot,
    });
  }, [
    heading,
    subheading,
    showBack,
    centerTitle,
    compactTitle,
    centerSlot,
    leadingSlot,
    titleSlot,
    alignItemsTop,
    extraActions,
    hideInbox,
    hideNotifications,
    hideTrailing,
    onBack,
    rightActions,
    rightSlot,
    setContent,
  ]);

  useEffect(() => {
    return () => setContent({});
  }, [setContent]);
}
