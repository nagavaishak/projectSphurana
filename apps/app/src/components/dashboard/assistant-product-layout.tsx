import { AppSidebar } from '@/components/app-sidebar';
import { setUserGroup } from '@/components/posthog-provider';
import { SiteHeader } from '@/components/site-header';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import {
  useGetActiveOrganization,
  useListOrganizations,
  useSetActiveOrganization,
} from '@/features/organization';
import { intercomSetCompany } from '@/lib/intercom';
import { Outlet } from '@tanstack/react-router';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

/**
 * Matches Next `(protected)/assistant/layout.tsx` — org bootstrap, sidebar,
 * SiteHeader, full-height scroll region for the assistant page.
 */
export function AssistantProductLayout() {
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
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={
        {
          // No `--sidebar-width` override: #927 replaced the two-tier
          // rail-plus-panel nav with one full-width sidebar, so the assistant
          // inherits the same shadcn default (16rem) as the dashboard shell.
          // The old `calc(4.5rem + 1px)` sized the retired icon rail and now
          // squeezes every nav label down to an ellipsis.
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="bg-sidebar h-svh overflow-hidden">
        <SiteHeader />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
