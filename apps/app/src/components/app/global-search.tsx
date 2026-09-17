import { useListAppointments } from '@/features/appointments/api/list-appointments';
import type {
  AppointmentStatus,
  AppointmentWithRelations,
} from '@/features/appointments/api/types';
import { appointmentStatusLabels } from '@/features/appointments/api/types';
import { useListConversations } from '@/features/conversations/api/list-conversations';
import { useListCampaigns } from '@/features/meta-campaigns/api/list-campaigns';
import { useNavigate } from '@tanstack/react-router';
import { Command as CommandPrimitive } from 'cmdk';
import {
  CalendarIcon,
  CrosshairIcon,
  InboxIcon,
  MessageCircleIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  Settings2Icon,
  UserRoundIcon,
  WrenchIcon,
} from 'lucide-react';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';

const MAX_RESULTS = 5;

function PrimaryBadge({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#E5E5E5] px-2 py-0.5 text-xs font-medium text-[#0A0A0A]">
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function SecondaryBadge({
  icon: Icon,
  label,
}: {
  icon: React.ElementType;
  label: string;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#262626] px-2 py-0.5 text-xs font-medium text-[#A3A3A3]">
      <Icon className="size-3" />
      {label}
    </span>
  );
}

function ConversationBadge({ status }: { status: string }) {
  switch (status) {
    case 'agent_handling':
      return (
        <SecondaryBadge icon={MessageCircleIcon} label="In Conversation" />
      );
    case 'active':
      return <PrimaryBadge icon={MessageCircleIcon} label="Active" />;
    case 'bot_handling':
      return <SecondaryBadge icon={MessageCircleIcon} label="Bot Active" />;
    default:
      return null;
  }
}

function CampaignBadge({ status }: { status: string }) {
  if (status === 'ACTIVE') {
    return <PrimaryBadge icon={PlayIcon} label="Active" />;
  }
  return <SecondaryBadge icon={PauseIcon} label="Paused" />;
}

/** Statuses that represent a still-active booking (primary emphasis). */
const ACTIVE_APPOINTMENT_STATUSES: readonly AppointmentStatus[] = [
  'booked',
  'confirmed',
  'arrived',
  'started',
];

function AppointmentBadge({ status }: { status: string }) {
  const label =
    appointmentStatusLabels[status as AppointmentStatus] ?? 'Appointment';
  if (ACTIVE_APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) {
    return <PrimaryBadge icon={CalendarIcon} label={label} />;
  }
  return <SecondaryBadge icon={CalendarIcon} label={label} />;
}

function getLeadName(lead: AppointmentWithRelations['lead']): string | null {
  if (!lead || typeof lead !== 'object' || !('firstName' in lead)) return null;
  return `${lead.firstName} ${(lead as { firstName: string; lastName: string | null }).lastName ?? ''}`.trim();
}

function SectionDivider() {
  return <div className="border-t border-[#262626]" />;
}

function SearchItem({
  onSelect,
  children,
}: {
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Item
      onSelect={onSelect}
      className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none data-[selected=true]:bg-[#1A1A1A]"
    >
      {children}
    </CommandPrimitive.Item>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return <div className="px-2 py-1.5 text-xs text-[#737373]">{children}</div>;
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function GlobalSearch({ open, onOpenChange }: GlobalSearchProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const q = deferredQuery.toLowerCase().trim();
  const shouldSearch = q.length > 0;

  const { conversations } = useListConversations(
    { limit: shouldSearch ? 25 : MAX_RESULTS, offset: 0 },
    { enabled: open }
  );
  const { campaigns } = useListCampaigns({ enabled: open });
  const { appointments } = useListAppointments(
    { limit: shouldSearch ? 25 : MAX_RESULTS, offset: 0 },
    { enabled: open && shouldSearch }
  );

  useEffect(() => {
    if (open) return;
    const t = setTimeout(() => setQuery(''), 150);
    return () => clearTimeout(t);
  }, [open]);

  const visibleConversations = useMemo(
    () =>
      conversations
        .filter((c) => {
          const name = (c.externalUserName ?? c.externalUserId).toLowerCase();
          return !q || name.includes(q);
        })
        .slice(0, MAX_RESULTS),
    [conversations, q]
  );

  const visibleCampaigns = useMemo(
    () =>
      campaigns
        .filter((c) => !q || c.name.toLowerCase().includes(q))
        .slice(0, MAX_RESULTS),
    [campaigns, q]
  );

  const visibleAppointments = useMemo(() => {
    if (!q) return [] as AppointmentWithRelations[];
    return appointments
      .filter((a) => {
        const name = getLeadName(a.lead)?.toLowerCase() ?? '';
        return name.includes(q);
      })
      .slice(0, MAX_RESULTS);
  }, [appointments, q]);

  if (!open) return null;

  const go = (href: string) => {
    void navigate({ to: href });
    onOpenChange(false);
  };

  const hasPeople = visibleConversations.length > 0;
  const hasCampaigns = visibleCampaigns.length > 0;
  const hasAppointments = visibleAppointments.length > 0;
  const showSuggestions = !q;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
      aria-label="Global search"
    >
      <button
        type="button"
        aria-label="Close search"
        className="absolute inset-0 bg-black/60"
        onClick={() => onOpenChange(false)}
      />

      <div
        className="relative z-10 flex w-[448px] flex-col overflow-hidden rounded-[10px] border border-[#262626] bg-[#0A0A0A]"
        style={{
          boxShadow:
            '0px 4px 6px -1px rgba(0,0,0,0.3), 0px 2px 4px -2px rgba(0,0,0,0.3)',
        }}
      >
        <CommandPrimitive
          shouldFilter={false}
          loop
          onKeyDown={(e) => {
            if (e.key === 'Escape') onOpenChange(false);
          }}
        >
          <div className="flex h-10 items-center gap-2 border-b border-[#262626] px-3">
            <SearchIcon className="size-4 shrink-0 text-[#737373]" />
            <CommandPrimitive.Input
              value={query}
              onValueChange={setQuery}
              placeholder="Type a command or search..."
              className="flex-1 bg-transparent py-3 text-sm text-white outline-none placeholder:text-[#737373]"
              autoFocus
            />
          </div>

          <CommandPrimitive.List className="max-h-[420px] overflow-y-auto py-1">
            {showSuggestions && (
              <CommandPrimitive.Group>
                <GroupHeading>Suggestions</GroupHeading>
                <div className="px-1">
                  {(
                    [
                      {
                        icon: InboxIcon,
                        label: 'Inbox',
                        href: '/dashboard/clients/inbox',
                      },
                      {
                        icon: WrenchIcon,
                        label: 'Services',
                        href: '/dashboard/catalog/services',
                      },
                      {
                        icon: Settings2Icon,
                        label: 'Settings',
                        href: '/dashboard/settings',
                      },
                    ] as const
                  ).map(({ icon: Icon, label, href }) => (
                    <SearchItem key={href} onSelect={() => go(href)}>
                      <Icon className="size-4 shrink-0 text-[#737373]" />
                      <span className="text-[#E5E5E5]">{label}</span>
                    </SearchItem>
                  ))}
                </div>
              </CommandPrimitive.Group>
            )}

            {hasPeople && (
              <>
                {showSuggestions && <SectionDivider />}
                <CommandPrimitive.Group>
                  <GroupHeading>People</GroupHeading>
                  <div className="px-1">
                    {visibleConversations.map((conv) => {
                      const name = conv.externalUserName ?? conv.externalUserId;
                      return (
                        <SearchItem
                          key={conv.id}
                          onSelect={() =>
                            go(`/dashboard/conversations?id=${conv.id}`)
                          }
                        >
                          <UserRoundIcon className="size-4 shrink-0 text-[#737373]" />
                          <span className="flex-1 truncate text-[#E5E5E5]">
                            {name}
                          </span>
                          <ConversationBadge status={conv.status} />
                        </SearchItem>
                      );
                    })}
                  </div>
                </CommandPrimitive.Group>
              </>
            )}

            {hasCampaigns && (
              <>
                {(showSuggestions || hasPeople) && <SectionDivider />}
                <CommandPrimitive.Group>
                  <GroupHeading>Advertising</GroupHeading>
                  <div className="px-1">
                    {visibleCampaigns.map((campaign) => (
                      <SearchItem
                        key={campaign.id}
                        onSelect={() =>
                          go(`/dashboard/advertising/${campaign.id}`)
                        }
                      >
                        <CrosshairIcon className="size-4 shrink-0 text-[#737373]" />
                        <div className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate text-[#E5E5E5]">
                            {campaign.name}
                          </span>
                          <span className="shrink-0 text-[#737373]">
                            {campaign.adCount} ads
                          </span>
                        </div>
                        <CampaignBadge status={campaign.effectiveStatus} />
                      </SearchItem>
                    ))}
                  </div>
                </CommandPrimitive.Group>
              </>
            )}

            {hasAppointments && (
              <>
                {(hasPeople || hasCampaigns) && <SectionDivider />}
                <CommandPrimitive.Group>
                  <GroupHeading>Appointments</GroupHeading>
                  <div className="px-1">
                    {visibleAppointments.map((appt) => {
                      const name = getLeadName(appt.lead) ?? 'Unknown';
                      return (
                        <SearchItem
                          key={appt.id}
                          onSelect={() => go('/dashboard/calendar')}
                        >
                          <CalendarIcon className="size-4 shrink-0 text-[#737373]" />
                          <span className="flex-1 truncate text-[#E5E5E5]">
                            {name}
                          </span>
                          <AppointmentBadge status={appt.status} />
                        </SearchItem>
                      );
                    })}
                  </div>
                </CommandPrimitive.Group>
              </>
            )}

            <CommandPrimitive.Empty className="py-4 text-center text-sm text-[#737373]">
              No results found.
            </CommandPrimitive.Empty>
          </CommandPrimitive.List>
        </CommandPrimitive>
      </div>
    </div>
  );
}
