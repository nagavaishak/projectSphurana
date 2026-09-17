import { useNavigate } from '@tanstack/react-router';
import { Ban, UserPlus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { type Lead, useListLeads } from '@/features/leads';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { MobileSearchField } from '@/features/mobile-ui';
import { useBranchRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

import { AppointmentClientAvatar } from './appointment-client-avatar';
import type { AppointmentCreateSearch } from './appointment-create-search';
import { AppointmentMobileCreatePageTitle } from './appointment-mobile-create-page-header';

function getClientDisplayName(lead: Lead): string {
  return lead.lastName ? `${lead.firstName} ${lead.lastName}` : lead.firstName;
}

interface AppointmentActionRowProps {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  className?: string;
}

function AppointmentActionRow({
  icon,
  label,
  onClick,
  className,
}: AppointmentActionRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 py-2 text-left active:opacity-80',
        className
      )}
    >
      {icon}
      <span className="text-[15px] font-medium text-black">{label}</span>
    </button>
  );
}

interface AppointmentMobileSelectClientProps {
  search: AppointmentCreateSearch;
}

export function AppointmentMobileSelectClient({
  search,
}: AppointmentMobileSelectClientProps) {
  const navigate = useNavigate();
  const routes = useBranchRoutes();
  const [query, setQuery] = useState('');
  const handleBack = useCallback(() => {
    void navigate({ to: routes.calendarDay });
  }, [navigate, routes]);

  useMobileDashboardHeaderContent({
    showBack: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const { leads, isLoading } = useListLeads({
    filters: {
      search: query.trim() || undefined,
      limit: 50,
    },
  });

  // Every navigation carries `practitionerId` forward — dropping it here is
  // what made the whole route flow lose the column's practitioner.
  const handleSelectClient = useCallback(
    (leadId: string) => {
      void navigate({
        to: routes.calendarNew,
        search: {
          date: search.date,
          hour: search.hour,
          minute: search.minute,
          practitionerId: search.practitionerId,
          leadId,
        },
      });
    },
    [
      navigate,
      search.date,
      search.hour,
      search.minute,
      search.practitionerId,
      routes,
    ]
  );

  const handleNewClient = useCallback(() => {
    void navigate({
      to: routes.calendarNewClient,
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

  const handleBlockOffTime = useCallback(() => {
    void navigate({
      to: routes.calendarNewBlock,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white px-4 pb-6">
      <AppointmentMobileCreatePageTitle
        title="Select Client"
        className="pb-2"
      />
      <div className="pb-2">
        <MobileSearchField
          value={query}
          onChange={setQuery}
          placeholder="Search your clients..."
        />
      </div>

      <AppointmentActionRow
        icon={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-black text-white">
            <Ban className="size-5" strokeWidth={2.25} />
          </span>
        }
        label="Block off time"
        onClick={handleBlockOffTime}
      />

      <AppointmentActionRow
        icon={
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#2E65F3] text-white">
            <UserPlus className="size-5" strokeWidth={2.25} />
          </span>
        }
        label="New client"
        onClick={handleNewClient}
      />

      <div className="border-t border-[#F2F2F7]" />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="py-6 text-center text-[14px] text-[#8E8E93]">
            Loading clients...
          </p>
        ) : leads.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-[#8E8E93]">
            No clients found.
          </p>
        ) : (
          <ul>
            {leads.map((lead) => {
              const name = getClientDisplayName(lead);
              return (
                <li key={lead.id} className="border-b border-[#F2F2F7]">
                  <button
                    type="button"
                    onClick={() => handleSelectClient(lead.id)}
                    className="flex w-full items-center gap-3 py-2.5 text-left active:bg-[#F2F2F7]"
                  >
                    <AppointmentClientAvatar name={name} />
                    <span className="text-[15px] font-medium text-black">
                      {name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
