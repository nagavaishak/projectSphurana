'use client';

import {
  Brush,
  Building2,
  CalendarDays,
  CreditCard,
  MapPin,
  MessageCircle,
  Settings2,
  Shield,
  Users,
} from 'lucide-react';
import * as React from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { BillingTab } from './tabs/billing';
import { BookingsTab } from './tabs/bookings';
import { BrandingTab } from './tabs/branding';
import { ClaireTab } from './tabs/claire';
import { DefaultsTab } from './tabs/defaults';
import { DetailsTab } from './tabs/details';
import { LocationsTab } from './tabs/locations';
import { MembersTab } from './tabs/members';
import { PrivacyTab } from './tabs/privacy';
const data = {
  nav: [
    { name: 'Details', icon: Building2 },
    { name: 'Branding', icon: Brush },
    { name: 'Billing', icon: CreditCard },
    { name: 'Members', icon: Users },
    { name: 'Locations', icon: MapPin },
    { name: 'Bookings', icon: CalendarDays },
    { name: 'Claire', icon: MessageCircle },
    { name: 'Defaults', icon: Settings2 },
    { name: 'Privacy', icon: Shield },
  ],
};

export type OrgSettingsTab =
  | 'Details'
  | 'Branding'
  | 'Billing'
  | 'Members'
  | 'Locations'
  | 'Bookings'
  | 'Claire'
  | 'Defaults'
  | 'Privacy';

export function OrgSettingsDialog({
  open,
  setOpen,
  defaultTab = 'Details',
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  defaultTab?: OrgSettingsTab;
}) {
  const [selectedTab, setSelectedTab] =
    React.useState<OrgSettingsTab>(defaultTab);

  React.useEffect(() => {
    if (open) {
      setSelectedTab(defaultTab);
    }
  }, [open, defaultTab]);

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="overflow-hidden p-0 md:max-h-[600px] md:max-w-[700px] lg:max-w-[800px]">
        <DialogTitle className="sr-only">Organization Settings</DialogTitle>
        <DialogDescription className="sr-only">
          Customize your organization settings here.
        </DialogDescription>
        <SidebarProvider className="items-start">
          <Sidebar collapsible="none" className="hidden md:flex">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {data.nav.map((item) => (
                      <SidebarMenuItem key={item.name}>
                        <SidebarMenuButton
                          asChild
                          isActive={selectedTab === item.name}
                        >
                          <button
                            type="button"
                            className="cursor-pointer"
                            onClick={(e) => {
                              e.preventDefault();
                              setSelectedTab(item.name as OrgSettingsTab);
                            }}
                          >
                            <item.icon />
                            <span>{item.name}</span>
                          </button>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
          <main className="flex h-[560px] flex-1 flex-col overflow-hidden">
            <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
              <div className="flex items-center gap-2 px-4">
                <Breadcrumb>
                  <BreadcrumbList>
                    <BreadcrumbItem className="hidden md:block">
                      <BreadcrumbLink href="#">Settings</BreadcrumbLink>
                    </BreadcrumbItem>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem>
                      <BreadcrumbPage>{selectedTab}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto">
              {selectedTab === 'Details' && (
                <DetailsTab onCancel={handleClose} />
              )}
              {selectedTab === 'Branding' && (
                <BrandingTab onCancel={handleClose} />
              )}
              {selectedTab === 'Billing' && <BillingTab />}
              {selectedTab === 'Members' && <MembersTab />}
              {selectedTab === 'Locations' && <LocationsTab />}
              {selectedTab === 'Bookings' && (
                <BookingsTab onCancel={handleClose} />
              )}
              {selectedTab === 'Claire' && <ClaireTab />}
              {selectedTab === 'Defaults' && (
                <DefaultsTab onCancel={handleClose} />
              )}
              {selectedTab === 'Privacy' && <PrivacyTab />}
            </div>
          </main>
        </SidebarProvider>
      </DialogContent>
    </Dialog>
  );
}
