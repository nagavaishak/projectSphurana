import { AppSidebar } from '@/components/app-sidebar';
import { PageTransition } from '@/components/app/route-transition';
import {
  SidePanelLayout,
  SidePanelProvider,
} from '@/components/app/side-panel';
import { setUserGroup } from '@/components/posthog-provider';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { ConversationsPanel } from '@/features/conversations/components/conversations-panel';
import {
  MobileBottomTabs,
  useMobileBottomTabBarClearanceClass,
} from '@/features/mobile-bottom-tabs';
import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderClearanceClass,
} from '@/features/mobile-dashboard-header';
import {
  useGetActiveOrganization,
  useListOrganizations,
  useSetActiveOrganization,
} from '@/features/organization';
import { stripBranchFromPath } from '@/features/organization-locations/branch-path';
import { CheckoutSheet, QuickPaymentEntry } from '@/features/sales';
import { useIsMobile } from '@/hooks/use-mobile';
import { intercomSetCompany } from '@/lib/intercom';
import { cn } from '@/lib/utils';
import { Outlet, useRouterState } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

/**
 * Dashboard chrome: AppSidebar, optional conversations column, SidebarInset
 * (sidebar-colored background), outlet.
 */
export function DashboardLayoutShell() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isMobile = useIsMobile();
  const mobileTabClearance = useMobileBottomTabBarClearanceClass();
  const mobileHeaderClearance = useMobileDashboardHeaderClearanceClass();
  const showMobileBottomTabs = mobileTabClearance !== undefined;
  const showMobileDashboardHeader = mobileHeaderClearance !== undefined;
  // Compared against the BRANCH-STRIPPED path. Every dashboard surface now
  // lives under `/dashboard/l/<branch>/…`, so matching the raw pathname against
  // an un-prefixed literal is permanently false — which silently cost the
  // desktop inbox its conversation list (line 125 is the only place that panel
  // renders on desktop; the route itself only mounts it in its mobile arm) and
  // cost the calendar its full-height layout below.
  const normalised = stripBranchFromPath(pathname);
  const isConversations = normalised.startsWith('/dashboard/clients/inbox');
  const isCalendar = normalised.startsWith('/dashboard/calendar');
  // Routes that own their own internal scroll and must fill the viewport
  // exactly (no page-level scroll) rather than growing to content height.
  const isFullHeight = isConversations || isCalendar;
  // NOTE: list pages are NOT in this list. `ListPage` marks itself with
  // `data-list-page`, and the classes below constrain the shell via `:has()`
  // when one is present — so 23 list routes do not each need a path here, and a
  // new one cannot forget to add itself.

  const { data: activeOrg, isPending: activeOrgPending } =
    useGetActiveOrganization();
  const { data: organizations, isPending: orgsPending } =
    useListOrganizations();
  const { execute: setActiveOrg } = useSetActiveOrganization();

  const isLoading = activeOrgPending || orgsPending;

  useEffect(() => {
    if (isLoading) return;
    if (!activeOrg && organizations.length > 0) {
      void setActiveOrg({ organizationId: organizations[0].id }).catch(
        console.error
      );
    }
  }, [activeOrg, organizations, isLoading, setActiveOrg]);

  useEffect(() => {
    if (activeOrg) {
      setUserGroup('organization', activeOrg.id);
      void intercomSetCompany({ id: activeOrg.id, name: activeOrg.name });
    }
  }, [activeOrg]);

  if (isLoading || (!activeOrg && organizations.length > 0)) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <MobileDashboardHeaderProvider>
      <div
        className={cn(
          'flex w-full flex-col',
          isFullHeight ? 'h-svh overflow-hidden' : 'min-h-svh',
          'has-[[data-list-page]]:h-svh has-[[data-list-page]]:overflow-hidden'
        )}
        style={
          {
            '--header-height': 'calc(var(--spacing) * 12)',
          } as CSSProperties
        }
      >
        {/*
          No desktop top bar. The full-width header that used to sit here held
          a logo, the notification bell and an account menu; the bell and the
          account menu now live in the sidebar rail's footer, and the logo went
          with it — the branch you are in (LocationSwitcher, rail header) is the
          orientation that actually matters in a location-scoped product.

          Mobile is untouched: it has no visible sidebar, so it keeps its own
          headers (MobileDashboardHeader / the per-tab headers in SiteHeader).
        */}
        <SidebarProvider
          // One column at the shadcn default width. The old two-tier sidebar
          // swapped between a 4.5rem rail and rail-plus-panel here, so the
          // window changed width as you moved between sections.
          className={cn(
            'min-h-0 flex-1',
            isFullHeight && 'overflow-hidden',
            'has-[[data-list-page]]:overflow-hidden'
            // The sidebar used to be pushed down by `top-(--header-height)` so
            // the full-width header could span above it. With the header gone
            // the rail runs the full height of the viewport, which is what
            // `inset-y-0` on sidebar-container already does — so both offsets
            // are removed rather than zeroed.
          )}
        >
          <AppSidebar />
          {isConversations ? (
            <div
              className="bg-sidebar text-sidebar-foreground hidden w-[300px] shrink-0 flex-col overflow-hidden border-r md:flex"
              data-conversations-list=""
            >
              <ConversationsPanel />
            </div>
          ) : null}
          <SidebarInset
            data-mobile-dock-scroll-container={
              mobileTabClearance ? '' : undefined
            }
            className={cn(
              'bg-sidebar',
              // Let the inset shrink to the viewport instead of growing to its
              // widest child. Without this, a flex child's default `min-width:
              // auto` lets wide content (e.g. planner rows with long captions)
              // push the whole page wider than the screen and scroll sideways.
              'min-w-0',
              isFullHeight ? 'min-h-0 overflow-hidden' : '',
              'has-[[data-list-page]]:flex has-[[data-list-page]]:min-h-0 has-[[data-list-page]]:flex-col has-[[data-list-page]]:overflow-hidden',
              mobileTabClearance,
              mobileHeaderClearance,
              // Full-height dashboard routes (calendar, inbox) shrink above the tab bar on mobile.
              mobileTabClearance && isMobile && 'min-h-0 flex flex-col'
            )}
          >
            <SidePanelProvider>
              <SidePanelLayout>
                <PageTransition key={pathname}>
                  <Outlet />
                </PageTransition>
              </SidePanelLayout>
            </SidePanelProvider>
          </SidebarInset>
          {showMobileDashboardHeader ? <MobileDashboardHeader /> : null}
          {showMobileBottomTabs ? <MobileBottomTabs /> : null}
        </SidebarProvider>
      </div>
      {/* Wide checkout sheet — opened from anywhere via useCheckoutStore. */}
      <CheckoutSheet />
      <QuickPaymentEntry />
    </MobileDashboardHeaderProvider>
  );
}
