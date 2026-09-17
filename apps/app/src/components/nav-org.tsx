import {
  OrgSettingsDialog,
  type OrgSettingsTab,
} from '@/components/app/org-settings';
import { useNavigate } from '@tanstack/react-router';
import { LogOut, MoreVertical, Settings } from 'lucide-react';
import * as React from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from '@/components/ui/sidebar';
import { useSignOut } from '@/features/auth/use-sign-out';
import { useGetActiveOrganization } from '@/features/organization/api/get-active-organization';
import { useSession } from '@/lib/session';

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function NavOrg({ compact }: { compact?: boolean } = {}) {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const { data } = useSession();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsTab, setSettingsTab] =
    React.useState<OrgSettingsTab>('Details');

  const { data: organization } = useGetActiveOrganization();

  const userName = data?.user?.name ?? data?.user?.email ?? 'Account';
  const orgName = organization?.name ?? userName;
  const orgLogo = organization?.logo ?? undefined;
  const orgInitials = organization?.name
    ? getInitials(organization.name)
    : getInitials(userName);

  const openSettings = (tab: OrgSettingsTab) => {
    setSettingsTab(tab);
    setSettingsOpen(true);
  };

  const { signOut, isSigningOut } = useSignOut({
    onSuccess: () => navigate({ to: '/sign-in' }),
  });

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className={`data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground${compact ? ' md:h-8 md:p-0' : ''}`}
            >
              <Avatar className="h-8 w-8 rounded-lg">
                <AvatarImage src={orgLogo} alt={orgName} />
                <AvatarFallback className="rounded-lg">
                  {orgInitials}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{orgName}</span>
                <span className="text-muted-foreground truncate text-xs">
                  Pro Plan
                </span>
              </div>
              <MoreVertical className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  <AvatarImage src={orgLogo} alt={orgName} />
                  <AvatarFallback className="rounded-lg">
                    {orgInitials}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{orgName}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    Pro Plan
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={() => openSettings('Details')}>
                <Settings />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => signOut()} disabled={isSigningOut}>
              <LogOut />
              {isSigningOut ? 'Signing out...' : 'Log out'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <OrgSettingsDialog
        open={settingsOpen}
        setOpen={setSettingsOpen}
        defaultTab={settingsTab}
      />
    </SidebarMenu>
  );
}
