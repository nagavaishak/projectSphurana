import { ROUTES } from '@/lib/route-paths';
import { Link, useRouterState } from '@tanstack/react-router';
import {
  ArrowLeft,
  FileText,
  Megaphone,
  MessageSquare,
  PlugZap,
  Shield,
  Users,
  Video,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar';

const IMPERSONATE_PREFIX = '/admin';
const VIDEO_PREFIX = '/admin/template-builder';

interface AdminNavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
  items?: {
    title: string;
    url: string;
    icon: LucideIcon;
    isActive: (pathname: string) => boolean;
  }[];
}

const isImpersonateActive = (pathname: string) =>
  pathname === IMPERSONATE_PREFIX ||
  pathname === `${IMPERSONATE_PREFIX}/` ||
  pathname.startsWith('/admin/organizations');

const isVideoActive = (pathname: string) => pathname.startsWith(VIDEO_PREFIX);

const AUDIT_LOG_PREFIX = '/admin/audit-log';

const isAuditLogActive = (pathname: string) =>
  pathname.startsWith(AUDIT_LOG_PREFIX);

const META_CONNECTIONS_PREFIX = '/admin/meta-connections';

const isMetaConnectionsActive = (pathname: string) =>
  pathname.startsWith(META_CONNECTIONS_PREFIX);

const CONVERSATIONS_PREFIX = '/admin/conversations';
const ADVERTISING_PREFIX = '/admin/advertising';

const isConversationsActive = (pathname: string) =>
  pathname.startsWith(CONVERSATIONS_PREFIX);
const isAdvertisingActive = (pathname: string) =>
  pathname.startsWith(ADVERTISING_PREFIX);

const NAV_ITEMS: AdminNavItem[] = [
  {
    title: 'Impersonate',
    url: IMPERSONATE_PREFIX,
    icon: Users,
    isActive: isImpersonateActive,
  },
  {
    title: 'Conversations',
    url: CONVERSATIONS_PREFIX,
    icon: MessageSquare,
    isActive: isConversationsActive,
  },
  {
    title: 'Advertising',
    url: ADVERTISING_PREFIX,
    icon: Megaphone,
    isActive: isAdvertisingActive,
  },
  {
    title: 'Meta connections',
    url: META_CONNECTIONS_PREFIX,
    icon: PlugZap,
    isActive: isMetaConnectionsActive,
  },
  {
    title: 'Audit Log',
    url: AUDIT_LOG_PREFIX,
    icon: FileText,
    isActive: isAuditLogActive,
  },
  {
    title: 'Video',
    url: VIDEO_PREFIX,
    icon: Video,
    isActive: isVideoActive,
  },
];

export function AdminSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === 'collapsed';

  const handleNavigate = () => {
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon" variant="sidebar" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="Admin"
              size="lg"
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-md">
                <Shield className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Admin</span>
                <span className="text-muted-foreground truncate text-xs">
                  Platform tools
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => {
                const active = item.isActive(pathname);
                const Icon = item.icon;

                if (item.items?.length) {
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        tooltip={item.title}
                        asChild
                        isActive={active}
                      >
                        <Link to={item.url} onClick={handleNavigate}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {!collapsed && active ? (
                        <SidebarMenuSub>
                          {item.items.map((sub) => {
                            const SubIcon = sub.icon;
                            const subActive = sub.isActive(pathname);
                            return (
                              <SidebarMenuSubItem key={sub.title}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={subActive}
                                >
                                  <Link to={sub.url} onClick={handleNavigate}>
                                    <SubIcon className="size-3.5" />
                                    <span>{sub.title}</span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      ) : null}
                    </SidebarMenuItem>
                  );
                }

                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      tooltip={item.title}
                      asChild
                      isActive={active}
                    >
                      <Link to={item.url} onClick={handleNavigate}>
                        <Icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip="Back to dashboard" asChild>
              <Link to={ROUTES.dashboard} onClick={handleNavigate}>
                <ArrowLeft />
                <span>Back to dashboard</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
