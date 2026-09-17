'use client';

import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';

/**
 * shadcn `sidebar-10` → `nav-secondary.tsx`, 1:1, with `<a href>` swapped for a
 * TanStack `<Link to>` and support for a plain button row (Help opens Intercom;
 * it has no URL). Rendered with `className="mt-auto"` so it sits at the foot of
 * SidebarContent, exactly as the block does.
 */
export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string;
    /** Omit for a button row (Help) driven by `onSelect`. */
    url?: string;
    icon: LucideIcon;
    isActive?: boolean;
    badge?: React.ReactNode;
    onSelect?: () => void;
  }[];
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.url ? (
                <SidebarMenuButton asChild isActive={item.isActive}>
                  <Link onClick={item.onSelect} to={item.url}>
                    <item.icon />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton onClick={item.onSelect}>
                  <item.icon />
                  <span>{item.title}</span>
                </SidebarMenuButton>
              )}
              {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
