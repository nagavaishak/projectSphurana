import { ChevronDown, Plus } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '@/components/ui/sidebar';
import { useGetActiveOrganization } from '@/features/organization/api/get-active-organization';
import { useSession } from '@/lib/session';

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function TeamSwitcher() {
  const { data: session } = useSession();
  const { data: organization } = useGetActiveOrganization();

  const userName = session?.user?.name ?? session?.user?.email ?? 'Account';
  const orgName = organization?.name ?? userName;
  const orgLogo = organization?.logo ?? undefined;
  const orgInitials = getInitials(organization?.name ?? userName);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="w-fit max-w-full px-1.5 group-data-[collapsible=icon]:!p-1.5">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-5 shrink-0 items-center justify-center overflow-hidden rounded-md">
                {orgLogo ? (
                  <img src={orgLogo} alt="" className="size-5 object-cover" />
                ) : (
                  <span className="text-[10px] font-medium">{orgInitials}</span>
                )}
              </div>
              <span className="truncate font-medium">{orgName}</span>
              <ChevronDown className="opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-64 rounded-lg"
            align="start"
            side="bottom"
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Organization
            </DropdownMenuLabel>
            <DropdownMenuItem className="gap-2 p-2">
              <div className="flex size-6 items-center justify-center overflow-hidden rounded-xs border">
                {orgLogo ? (
                  <img src={orgLogo} alt="" className="size-6 object-cover" />
                ) : (
                  <span className="text-[10px] font-medium">{orgInitials}</span>
                )}
              </div>
              <span className="min-w-0 truncate">{orgName}</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 p-2">
              <div className="bg-background flex size-6 items-center justify-center rounded-md border">
                <Plus className="size-4" />
              </div>
              <div className="text-muted-foreground font-medium">Add team</div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
