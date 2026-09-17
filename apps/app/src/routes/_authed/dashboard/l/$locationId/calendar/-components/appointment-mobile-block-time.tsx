import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';

import { useBranchRoutes } from '@/lib/use-routes';

import { Button } from '@/components/ui/button';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { MobileBlockedTimeForm } from '@/features/scheduling';

import {
  type AppointmentCreateSearch,
  parseAppointmentSlotDate,
} from './appointment-create-search';
import { AppointmentMobileCreatePageTitle } from './appointment-mobile-create-page-header';

interface AppointmentMobileBlockTimeProps {
  search: AppointmentCreateSearch;
}

/**
 * MOBILE funnel step for blocking off time. A thin shell around the SHARED
 * blocked-time core (`MobileBlockedTimeForm`) — same schema, same fields, same
 * payload builder as the desktop dialog. The funnel presentation is kept; the
 * type preset, multi-practitioner selection and recurrence-end condition are
 * now reachable on a phone.
 */
export function AppointmentMobileBlockTime({
  search,
}: AppointmentMobileBlockTimeProps) {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const [isSaving, setIsSaving] = useState(false);

  const initial = useMemo(
    () => ({
      startDate: parseAppointmentSlotDate(search),
      ...(search.hour !== undefined && search.minute !== undefined
        ? { startTime: { hour: search.hour, minute: search.minute } }
        : {}),
      practitionerId: search.practitionerId,
    }),
    [search]
  );

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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-15">
        <AppointmentMobileCreatePageTitle
          title="Block Time Off"
          subtitle="Mark a time slot unavailable for customers to book"
        />

        <MobileBlockedTimeForm
          formId="appointment-block-time-form"
          initial={initial}
          onPendingChange={setIsSaving}
          onSaved={() => {
            void navigate({ to: routes.calendarDay });
          }}
        />
      </div>

      <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-[#F2F2F7] bg-white px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        <Button
          type="submit"
          form="appointment-block-time-form"
          disabled={isSaving}
          className="h-[50px] w-full rounded-xl bg-black text-[15px] font-medium text-white hover:bg-black/90"
        >
          {isSaving ? 'Saving...' : 'Save Block'}
        </Button>
      </div>
    </div>
  );
}
