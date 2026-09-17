import { useRouterState } from '@tanstack/react-router';
import { Settings } from 'lucide-react';
import { useFeatureFlagEnabled } from 'posthog-js/react';
import type * as React from 'react';
import { useEffect, useMemo, useState } from 'react';

import { GlobalSearch } from '@/components/app/global-search';
import { LocationSwitcher } from '@/components/location-switcher';
import { NavSecondary } from '@/components/nav-secondary';
import { NavSections } from '@/components/nav-sections';
import { NavUser } from '@/components/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization/get-active-organization.hook';
import {
  type DashboardNavSection as NavSection,
  dashboardAssistantSection as assistantSection,
  filterNavForBookingDestination,
  isDashboardSectionActive as isSectionActive,
  dashboardNavSections as navSections,
} from '@/lib/dashboard-nav';

function getPosthogKey(): string | undefined {
  const config = typeof window !== 'undefined' ? window.__CONFIG__ : undefined;
  return (config as { posthogKey?: string } | undefined)?.posthogKey;
}

function AppSidebarWithPostHogNav(props: React.ComponentProps<typeof Sidebar>) {
  const claireAssistantEnabled = useFeatureFlagEnabled(
    'claire-assistant-sidebar'
  );
  // Organizations that take bookings elsewhere have no appointments, till or
  // stock here, so the booking-system surface is hidden rather than shown
  // empty (ENG-500).
  const { data: organization } = useActiveOrganization();
  const sections = useMemo(() => {
    const withAssistant = claireAssistantEnabled
      ? [...navSections, assistantSection]
      : navSections;
    return filterNavForBookingDestination(
      withAssistant,
      organization?.bookingDestination
    );
  }, [claireAssistantEnabled, organization?.bookingDestination]);
  return <AppSidebarInner {...props} sections={sections} />;
}

/**
 * Single-column sidebar, taken from shadcn `sidebar-10`:
 *
 *   SidebarHeader   LocationSwitcher (the block's TeamSwitcher slot) + NavMain
 *   SidebarContent  NavSections (the block's NavWorkspaces) + NavSecondary
 *   SidebarFooter   NavUser (from sidebar-08)
 *   SidebarRail
 *
 * This replaced a two-tier `sidebar-09` rail — a 72px icon column plus a
 * secondary panel that appeared only for sections with sub-items. That shape
 * hid every label behind a tooltip and made the window change width as you
 * moved between sections. One column, always labelled, sections that expand in
 * place.
 */
function AppSidebarInner({
  sections,
  ...props
}: React.ComponentProps<typeof Sidebar> & { sections: NavSection[] }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isMobile, setOpenMobile } = useSidebar();
  const [searchOpen, setSearchOpen] = useState(false);

  // ⌘K / Ctrl-K. Lived in the desktop header until that was removed; the
  // shortcut is muscle memory, so it moved with the button rather than dying
  // with the header.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  // Settings is pinned to NavSecondary at the foot rather than listed with the
  // working sections — it is where you go to change the shop, not to run it.
  const workingSections = sections.filter((s) => s.slug !== 'settings');
  const settingsSection = sections.find((s) => s.slug === 'settings');

  return (
    <Sidebar className="border-r-0" {...props}>
      {/*
        `pb-0`: SidebarHeader's own `p-2` and the first nav group's `p-2` stack
        into a 16px gap under the switcher, against a 4px rhythm between the
        rows below it. Dropping the header's bottom padding leaves the group's
        8px — still a visible break between the branch and the nav, without the
        hole.
      */}
      <SidebarHeader className="pb-0">
        <LocationSwitcher />
      </SidebarHeader>
      {/*
        `gap-0`: SidebarContent's own `gap-2` stacked with each group's `p-2` to
        put 24px between groups, three times the 8px seam under the switcher.
        The groups own their spacing (`pb-0` below), so every seam is 8px.
      */}
      <SidebarContent className="gap-0">
        <NavSections
          onNavigate={handleNavigate}
          pathname={pathname}
          sections={workingSections}
        />
        <NavSecondary
          className="mt-auto pb-0"
          items={[
            ...(settingsSection
              ? [
                  {
                    title: settingsSection.title,
                    url: settingsSection.url,
                    icon: Settings,
                    isActive: isSectionActive(settingsSection, pathname),
                    onSelect: handleNavigate,
                  },
                ]
              : []),
          ]}
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser />
      </SidebarFooter>
      <SidebarRail />
      <GlobalSearch onOpenChange={setSearchOpen} open={searchOpen} />
    </Sidebar>
  );
}

/**
 * PostHog hooks require `PostHogProvider`, which only mounts when
 * `VITE_PUBLIC_POSTHOG_KEY` is set (`posthog-provider.tsx`). Match
 * `dashboard/home.tsx`: without a key, skip flags and use default nav.
 */
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  if (!getPosthogKey()) {
    return <AppSidebarInner {...props} sections={navSections} />;
  }
  return <AppSidebarWithPostHogNav {...props} />;
}
