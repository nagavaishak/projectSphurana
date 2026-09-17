import { PageShell } from '@/components/app/page-shell';
import { Skeleton } from '@/components/ui/skeleton';
import { useListAppointments } from '@/features/appointments/api/list-appointments/list-appointments.hook';
import { useActiveRecommendations } from '@/features/claire';
import { useListConversations } from '@/features/conversations/api/list-conversations/list-conversations.hook';
import { PendingInvitationsBanner } from '@/features/organization';
import { useSession } from '@/lib/session';
import type {
  AppointmentWithRelations,
  AssistantRecommendationKind,
  ConversationListItem,
} from '@borradh-workspace/api-client/types';
import {
  CalendarClock,
  CalendarDays,
  Clock,
  Flame,
  Lightbulb,
  MessagesSquare,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  UserCheck,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { HomePrompt } from './home-prompt';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function formatTimeRange(start: string | Date, end: string | Date): string {
  const fmt = (v: string | Date) => {
    const d = typeof v === 'string' ? new Date(v) : v;
    return d.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
  };
  return `${fmt(start)}-${fmt(end)}`;
}

function leadDisplayName(appt: AppointmentWithRelations): string {
  // `Serialize<>` widens the optional `lead` relation to include scalar
  // fallbacks; runtime is always `undefined` or the relation object, so guard
  // before reading the relation fields.
  const lead = typeof appt.lead === 'object' && appt.lead ? appt.lead : null;
  const first = lead?.firstName ?? '';
  const last = lead?.lastName ?? '';
  const full = `${first} ${last}`.trim();
  return full || appt.title;
}

function kindIcon(kind: AssistantRecommendationKind): {
  Icon: LucideIcon;
  color: string;
} {
  switch (kind) {
    case 'content_no_post_14_days':
    case 'content_unused_assets':
    case 'content_learning_phase_prompt':
      return { Icon: Sparkles, color: '#9333ea' };
    case 'lead_first_of_session':
    case 'lead_unreplied_2h':
      return { Icon: UserCheck, color: '#2563eb' };
    case 'lead_flagged_problem':
      return { Icon: TriangleAlert, color: '#dc2626' };
    case 'booking_confirmed':
    case 'pre_appointment_prep':
      return { Icon: CalendarClock, color: '#16a34a' };
    case 'learning_phase_reassurance':
    case 'campaign_learning_phase_exit':
      return { Icon: Clock, color: '#2563eb' };
    case 'creative_refresh_needed':
    case 'creative_burnout':
      return { Icon: Flame, color: '#ea580c' };
    case 'no_show_surge':
    case 'cpl_spike':
      return { Icon: TriangleAlert, color: '#ca8a04' };
    case 'offer_expiring_soon':
      return { Icon: Clock, color: '#ca8a04' };
    case 'lead_volume_drop':
      return { Icon: TrendingDown, color: '#dc2626' };
    case 'prompt_create_first_ad':
      return { Icon: Target, color: '#16a34a' };
    case 'prompt_create_first_offer':
    case 'prompt_record_first_video':
    case 'prompt_create_first_graphic':
    case 'prompt_create_first_post':
      return { Icon: TrendingUp, color: '#16a34a' };
    default:
      return { Icon: Lightbulb, color: '#6b7280' };
  }
}

function conversationDisplayName(c: ConversationListItem): string {
  return c.externalUserName?.trim() || 'Customer';
}

function TodaysUpdateCard() {
  const todayStart = useMemo(() => startOfToday(), []);
  const todayEnd = useMemo(() => endOfToday(), []);

  const {
    appointments,
    isLoading: apptsLoading,
    isError: apptsError,
  } = useListAppointments({
    startDateFrom: todayStart,
    startDateTo: todayEnd,
    status: 'booked',
    limit: 50,
  });

  const { conversations, isLoading: convosLoading } = useListConversations({
    status: 'active',
    limit: 50,
  });

  const waitingConversations = useMemo(
    () => conversations.filter((c) => c.lastMessageRole === 'user'),
    [conversations]
  );

  const isLoading = apptsLoading || convosLoading;

  const sortedAppointments = useMemo(
    () =>
      [...appointments].sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime()
      ),
    [appointments]
  );

  const apptCount = sortedAppointments.length;
  const unreadCount = waitingConversations.length;
  const hasAnything = apptCount + unreadCount > 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Today's Update</p>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
        {isLoading ? (
          <div className="flex flex-col gap-5">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
        ) : apptsError ? (
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Appointments unavailable
              </p>
              <p className="text-sm italic text-muted-foreground">
                We couldn't load today's appointments.
              </p>
            </div>
          </div>
        ) : !hasAnything ? (
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                You're all caught up
              </p>
              <p className="text-sm italic text-muted-foreground">
                No appointments or messages waiting today.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {apptCount > 0 && (
              <div className="flex items-start gap-3">
                <CalendarDays
                  className="mt-0.5 size-5 shrink-0 text-foreground"
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {apptCount}{' '}
                    {apptCount === 1 ? 'Appointment' : 'Appointments'} Today
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {sortedAppointments.slice(0, 5).map((appt) => (
                      <li
                        key={appt.id}
                        className="flex items-baseline justify-between gap-3 text-sm italic text-muted-foreground"
                      >
                        <span className="min-w-0 truncate">
                          {leadDisplayName(appt)}
                        </span>
                        <span className="shrink-0 tabular-nums">
                          {formatTimeRange(appt.startDate, appt.endDate)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {unreadCount > 0 && (
              <div className="flex items-start gap-3">
                <MessagesSquare
                  className="mt-0.5 size-5 shrink-0 text-foreground"
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {unreadCount} Unread{' '}
                    {unreadCount === 1 ? 'Message' : 'Messages'}
                  </p>
                  <ul className="mt-1 flex flex-col gap-1">
                    {waitingConversations.slice(0, 5).map((c) => (
                      <li
                        key={c.id}
                        className="truncate text-sm italic text-muted-foreground"
                      >
                        {conversationDisplayName(c)}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TodaysRecommendationsCard() {
  const { recommendations, isLoading, isError } = useActiveRecommendations();

  if (!isLoading && (isError || recommendations.length === 0)) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">Today's Recommendations</p>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="size-5 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {recommendations.slice(0, 3).map((rec) => {
              const { Icon, color } = kindIcon(rec.kind);
              return (
                <div key={rec.id} className="flex items-start gap-3">
                  <Icon
                    className="mt-0.5 size-5 shrink-0"
                    style={{ color }}
                    strokeWidth={2}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {rec.title}
                    </p>
                    <p className="text-sm italic text-muted-foreground">
                      {rec.body}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * "Claire" home — the AI-first home screen. On mobile, Ask AI is available from
 * the floating bottom tab bar on this route.
 */
export function HomeNew() {
  const { data: session, isLoading: isSessionLoading } = useSession();
  const firstName = session?.user?.name?.split(' ')[0] ?? 'there';

  if (isSessionLoading) {
    return (
      <>
        <title>Claire | Borradh</title>
        <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]" fillHeight>
          <div className="flex flex-1 flex-col gap-6">
            <div className="mt-6 flex flex-col gap-2">
              <Skeleton className="h-7 w-64" />
              <Skeleton className="h-4 w-44" />
            </div>
            <Skeleton className="h-[160px] w-full rounded-2xl" />
            <Skeleton className="h-[160px] w-full rounded-2xl" />
          </div>
        </PageShell>
      </>
    );
  }

  return (
    <>
      <title>Claire | Borradh</title>
      <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]" fillHeight>
        <div className="flex flex-1 flex-col gap-6">
          <PendingInvitationsBanner />

          <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
            <div className="mt-6 flex flex-col gap-1">
              <h1 className="text-2xl font-semibold text-foreground">
                Welcome back, {firstName}
              </h1>
              <p className="text-sm text-muted-foreground">
                Here's your update for today
              </p>
            </div>

            <TodaysUpdateCard />
            <TodaysRecommendationsCard />
          </div>

          {/* Claire prompt — pinned to the bottom of the viewport via
              `mt-auto` (PageShell `fillHeight` stretches the column). */}
          <div className="mt-auto pt-6">
            <HomePrompt />
          </div>
        </div>
      </PageShell>
    </>
  );
}
