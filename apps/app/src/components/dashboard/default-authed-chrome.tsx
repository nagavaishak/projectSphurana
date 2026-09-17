import { AppSidebar } from '@/components/app-sidebar';
import { setUserGroup } from '@/components/posthog-provider';
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
 * Standard product chrome for authed routes outside `/dashboard/*` and
 * `/assistant` (billing, settings, sequences, etc.) — matches the assistant
 * layout minus the fixed full-viewport height constraint.
 */
export function DefaultAuthedChrome() {
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
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 64)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AppSidebar />
      <SidebarInset className="bg-sidebar">
        <Outlet />
      </SidebarInset>
    </SidebarProvider>
  );
}
