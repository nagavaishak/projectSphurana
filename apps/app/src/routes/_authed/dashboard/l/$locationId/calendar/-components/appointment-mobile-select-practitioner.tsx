import { useNavigate } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { useCallback } from 'react';

import { APPOINTMENT_NO_PRACTITIONER } from '@/features/appointments/create';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { useListPractitioners } from '@/features/practitioners';
import { useBranchRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

import { AppointmentClientAvatar } from './appointment-client-avatar';
import type { AppointmentCreateSearch } from './appointment-create-search';
import { AppointmentMobileCreatePageTitle } from './appointment-mobile-create-page-header';

interface AppointmentMobileSelectPractitionerProps {
  search: AppointmentCreateSearch;
}

/**
 * MOBILE funnel step: choose the team member. This step exists so the route
 * flow can carry a practitionerId at all — it used to be dropped on every
 * navigation, so a booking made from a phone was always unassigned and always
 * took the fallback tint.
 *
 * "Any team member" is an explicit choice (`APPOINTMENT_NO_PRACTITIONER`); we
 * never silently assign the first practitioner in the list.
 */
export function AppointmentMobileSelectPractitioner({
  search,
}: AppointmentMobileSelectPractitionerProps) {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const { practitioners, isLoading } = useListPractitioners({
    params: { isActive: true, bookable: true },
  });

  const handleBack = useCallback(() => {
    void navigate({
      to: routes.calendarNew,
      search: {
        date: search.date,
        hour: search.hour,
        minute: search.minute,
        leadId: search.leadId,
      },
    });
  }, [
    navigate,
    search.date,
    search.hour,
    search.minute,
    search.leadId,
    routes,
  ]);

  useMobileDashboardHeaderContent({
    showBack: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const handleSelect = useCallback(
    (practitionerId: string) => {
      void navigate({
        to: routes.calendarNew,
        search: {
          date: search.date,
          hour: search.hour,
          minute: search.minute,
          leadId: search.leadId,
          serviceId: search.serviceId,
          practitionerId,
        },
      });
    },
    [
      navigate,
      search.date,
      search.hour,
      search.minute,
      search.leadId,
      search.serviceId,
      routes,
    ]
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white px-4 pb-6">
      <AppointmentMobileCreatePageTitle
        title="Select Team Member"
        subtitle="Who is this appointment with?"
        className="pb-2"
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul>
          <li className="border-b border-[#F2F2F7]">
            <PractitionerRow
              name="Any team member"
              onSelect={() => handleSelect(APPOINTMENT_NO_PRACTITIONER)}
            />
          </li>
          {isLoading ? (
            <li className="py-6 text-center text-[14px] text-[#8E8E93]">
              Loading team...
            </li>
          ) : (
            practitioners.map((practitioner) => (
              <li key={practitioner.id} className="border-b border-[#F2F2F7]">
                <PractitionerRow
                  name={practitioner.name}
                  onSelect={() => handleSelect(practitioner.id)}
                />
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

function PractitionerRow({
  name,
  onSelect,
  className,
}: {
  name: string;
  onSelect: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 py-2.5 text-left active:bg-[#F2F2F7]',
        className
      )}
    >
      <AppointmentClientAvatar name={name} />
      <span className="min-w-0 flex-1 text-[15px] font-medium text-black">
        {name}
      </span>
      <ChevronRight
        className="size-4 shrink-0 text-[#C7C7CC]"
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}
