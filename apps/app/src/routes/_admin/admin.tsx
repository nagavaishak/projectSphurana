import { Outlet, createFileRoute } from '@tanstack/react-router';
import type { CSSProperties } from 'react';

import {
  SidePanelLayout,
  SidePanelProvider,
} from '@/components/app/side-panel';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { AdminSidebar } from '@/features/admin-terminal';

/**
 * Admin chrome: the platform AdminSidebar + a content inset. Wraps every
 * `/admin/*` page so the new Conversations/Advertising tabs (and the existing
 * Impersonate/Audit Log/Video pages) share one navigation. `SidePanelProvider`
 * is included because the reused AdsTable opens ad details in a side panel.
 */
export const Route = createFileRoute('/_admin/admin')({
  component: AdminLayout,
});

function AdminLayout() {
  return (
    <SidebarProvider
      style={
        {
          '--sidebar-width': 'calc(var(--spacing) * 64)',
          '--header-height': 'calc(var(--spacing) * 12)',
        } as CSSProperties
      }
    >
      <AdminSidebar />
      <SidebarInset className="min-w-0">
        <SidePanelProvider>
          <SidePanelLayout>
            <Outlet />
          </SidePanelLayout>
        </SidePanelProvider>
      </SidebarInset>
    </SidebarProvider>
  );
}
