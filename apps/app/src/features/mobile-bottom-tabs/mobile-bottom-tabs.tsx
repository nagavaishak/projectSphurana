import { MobileQuickAddSheet } from '@/features/mobile-quick-add';
import { BRANCH_PATHS, ROUTES } from '@/lib/route-paths';
import { useResolvedRoutes } from '@/lib/use-routes';
import { Link, useRouterState } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  LayoutGrid,
  MessageCircle,
  Plus,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import {
  MOBILE_TAB_BAR_ROW_HEIGHT_PX,
  mobileTabBarBottomOffsetStyle,
} from './mobile-bottom-tabs-layout';

const INACTIVE = '#757575';
const ACTIVE = '#000000';
const ROW_HEIGHT = MOBILE_TAB_BAR_ROW_HEIGHT_PX;

function tabColor(active: boolean): string {
  return active ? ACTIVE : INACTIVE;
}

function isAiTabActive(pathname: string): boolean {
  if (pathname === ROUTES.dashboard || pathname === `${ROUTES.dashboard}/`) {
    return true;
  }
  return pathname.startsWith(BRANCH_PATHS.home);
}

function isBookingsTabActive(pathname: string): boolean {
  return pathname.startsWith(BRANCH_PATHS.calendar);
}

/**
 * Mobile bottom navbar: a solid bar docked to the bottom edge with four tabs
 * and a centred quick-add button.
 *
 * Inbox is a TAB. It used to be a header shortcut beside the bell and the
 * avatar, which put the one surface a user opens all day behind a 48px glass
 * circle while Socials — a place you visit to plan, not to answer someone —
 * held a labelled tab. The header trio is gone (Profile and Notifications moved
 * into More), so the thing people actually come back for gets the tab, and
 * Socials keeps its place under Marketing in More.
 */
export function MobileBottomTabs() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const routes = useResolvedRoutes();
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const aiActive = isAiTabActive(pathname);
  const bookingsActive = isBookingsTabActive(pathname);
  const inboxActive = pathname.startsWith(routes.conversations);
  const moreActive = pathname.startsWith(ROUTES.more);

  return (
    <>
      <nav
        aria-label="Main"
        data-mobile-bottom-tabs=""
        className="fixed inset-x-0 bottom-0 z-[49] border-t border-[#E5E5E5] bg-white md:hidden"
        style={{
          ...mobileTabBarBottomOffsetStyle(),
          // Own view-transition group: keeps the bar anchored while the route
          // view transition fades/slides the screen content underneath it.
          viewTransitionName: 'mobile-bottom-tabs',
        }}
      >
        <div
          className="grid grid-cols-5 items-center"
          style={{ height: ROW_HEIGHT }}
        >
          <TabLink
            to={routes.home}
            label="Claire"
            icon={Sparkles}
            active={aiActive}
          />
          <TabLink
            to={routes.conversations}
            label="Inbox"
            icon={MessageCircle}
            active={inboxActive}
          />

          <div className="flex items-center justify-center">
            <button
              type="button"
              id="mobile-tab-quick-add"
              data-testid="mobile-tab-quick-add"
              // NOT "Add new". Pages carry their own "Add new" button (a new
              // sale, a new client, …), so on mobile that name resolved to TWO
              // different controls on the same screen: this FAB and the page's.
              // A screen-reader user hears "Add new" twice for two different
              // behaviours, and any by-name lookup is ambiguous. This one opens
              // the cross-cutting quick-add menu, so it gets its own name.
              aria-label="Quick add"
              aria-haspopup="dialog"
              aria-expanded={quickAddOpen}
              onClick={() => setQuickAddOpen(true)}
              className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-full transition active:scale-[0.97]"
            >
              <Plus className="size-7" strokeWidth={2.25} aria-hidden />
            </button>
          </div>

          <TabLink
            to={routes.calendarDay}
            label="Bookings"
            icon={Calendar}
            active={bookingsActive}
          />
          <TabLink
            to={ROUTES.more}
            label="More"
            icon={LayoutGrid}
            active={moreActive}
          />
        </div>
      </nav>

      <MobileQuickAddSheet open={quickAddOpen} onOpenChange={setQuickAddOpen} />
    </>
  );
}

function TabLink({
  to,
  label,
  icon: Icon,
  active,
}: {
  to: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
}) {
  const labelColor = tabColor(active);

  return (
    <Link
      to={to}
      // Animate the tab-screen swap with the View Transitions API. Reuses the
      // app's `::view-transition-*(root)` fade + slide-up (see styles.css);
      // honours prefers-reduced-motion via the same rule.
      viewTransition
      className={cn(
        'flex h-full min-w-0 flex-col items-center justify-center gap-1 px-1'
      )}
      aria-current={active ? 'page' : undefined}
    >
      <Icon
        className="size-6 shrink-0"
        style={{ color: labelColor }}
        strokeWidth={2}
        aria-hidden
      />
      <span
        className="w-full truncate text-center text-[10px] font-medium leading-tight"
        style={{ color: labelColor }}
      >
        {label}
      </span>
    </Link>
  );
}
