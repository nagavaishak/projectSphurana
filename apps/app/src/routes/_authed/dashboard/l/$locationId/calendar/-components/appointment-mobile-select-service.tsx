import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

import { useBranchRoutes } from '@/lib/use-routes';

import { useListLeads } from '@/features/leads';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';

import type { AppointmentCreateSearch } from './appointment-create-search';
import { AppointmentMobileCreatePageTitle } from './appointment-mobile-create-page-header';
import { AppointmentMobileServicePicker } from './appointment-mobile-service-picker';

interface AppointmentMobileSelectServiceProps {
  search: AppointmentCreateSearch;
}

function getClientName(
  lead: { firstName: string; lastName?: string | null } | undefined
): string {
  if (!lead) return 'Client';
  return lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.firstName;
}

export function AppointmentMobileSelectService({
  search,
}: AppointmentMobileSelectServiceProps) {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const leadId = search.leadId ?? '';

  const { leads } = useListLeads({ filters: { limit: 100 } });
  const selectedLead = leads.find((lead) => lead.id === leadId);

  const handleBack = useCallback(() => {
    void navigate({
      to: routes.calendarNew,
      search: {
        date: search.date,
        hour: search.hour,
        minute: search.minute,
        practitionerId: search.practitionerId,
      },
    });
  }, [
    navigate,
    search.date,
    search.hour,
    search.minute,
    search.practitionerId,
    routes,
  ]);

  useMobileDashboardHeaderContent({
    showBack: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const handleSelectService = useCallback(
    (serviceId: string) => {
      void navigate({
        to: routes.calendarNew,
        search: {
          date: search.date,
          hour: search.hour,
          minute: search.minute,
          leadId,
          serviceId,
          practitionerId: search.practitionerId,
        },
      });
    },
    [
      navigate,
      search.date,
      search.hour,
      search.minute,
      search.practitionerId,
      leadId,
      routes,
    ]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white px-4 pb-6">
      <AppointmentMobileCreatePageTitle
        title="Select Service"
        className="pb-2"
      />
      <AppointmentMobileServicePicker
        onSelect={handleSelectService}
        clientName={getClientName(selectedLead)}
      />
    </div>
  );
}
