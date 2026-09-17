import { useNavigate } from '@tanstack/react-router';
import { format } from 'date-fns';
import { useCallback, useState } from 'react';

import { useBranchRoutes } from '@/lib/use-routes';

import { Button } from '@/components/ui/button';
import { useAppointmentCreateContext } from '@/features/appointments/create';
import { useListLeads } from '@/features/leads';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';

import {
  type AppointmentCreateSearch,
  parseAppointmentSlotDate,
} from './appointment-create-search';
import { AppointmentMobileCreateDetailsForm } from './appointment-mobile-create-details-form';
import { AppointmentMobileCreatePageTitle } from './appointment-mobile-create-page-header';

interface AppointmentMobileCreateDetailsProps {
  search: AppointmentCreateSearch;
}

function getClientName(
  lead: { firstName: string; lastName?: string | null } | undefined
): string {
  if (!lead) return 'Client';
  return lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.firstName;
}

/**
 * MOBILE funnel step: the final "Create Appointment" screen. Renders the SHARED
 * create fields (date/time, team member, notes) — title, colour and end time are
 * derived from the service and the practitioner, exactly as on desktop.
 */
export function AppointmentMobileCreateDetails({
  search,
}: AppointmentMobileCreateDetailsProps) {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const leadId = search.leadId ?? '';
  const serviceId = search.serviceId ?? '';
  const slotDate = parseAppointmentSlotDate(search);
  const [isCreating, setIsCreating] = useState(false);

  const { leads } = useListLeads({ filters: { limit: 100 } });
  const selectedLead = leads.find((l) => l.id === leadId);
  // Resolve the service off the SAME list the payload builder uses.
  const { services } = useAppointmentCreateContext();
  const selectedService = services.find((service) => service.id === serviceId);

  const handleBack = useCallback(() => {
    void navigate({
      to: routes.calendarNew,
      search: {
        date: search.date,
        hour: search.hour,
        minute: search.minute,
        leadId,
        serviceId,
      },
    });
  }, [
    navigate,
    search.date,
    search.hour,
    search.minute,
    leadId,
    serviceId,
    routes,
  ]);

  useMobileDashboardHeaderContent({
    showBack: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  if (!selectedService) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-[14px] text-[#8E8E93]">
        Service not found. Go back and select a service.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-15">
        <AppointmentMobileCreatePageTitle title="Create Appointment" />
        <p className="pb-4 text-[14px] text-[#8E8E93]">
          Client:{' '}
          <span className="font-medium text-black">
            {getClientName(selectedLead)}
          </span>
          {' · '}
          Service:{' '}
          <span className="font-medium text-black">{selectedService.name}</span>
        </p>

        <AppointmentMobileCreateDetailsForm
          formId="appointment-create-details-form"
          leadId={leadId}
          serviceId={serviceId}
          slotDate={slotDate}
          defaultDate={search.date ?? format(slotDate, 'yyyy-MM-dd')}
          defaultHour={search.hour}
          defaultMinute={search.minute}
          practitionerId={search.practitionerId}
          onPendingChange={setIsCreating}
          onSuccess={() => {
            void navigate({ to: routes.calendarDay });
          }}
        />
      </div>

      <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-[#F2F2F7] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <Button
          type="submit"
          form="appointment-create-details-form"
          disabled={isCreating}
          className="h-[50px] w-full rounded-xl"
        >
          {isCreating ? 'Creating...' : 'Create Appointment'}
        </Button>
      </div>
    </div>
  );
}
