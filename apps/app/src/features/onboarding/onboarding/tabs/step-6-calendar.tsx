import { FieldGroup } from '@/components/ui/field';
import {
  IntegrationCard,
  IntegrationCardList,
} from '@/components/ui/integration-card';
import { IntegrationLinkButton } from '@/components/ui/integration-link-button';
import {
  useDisconnectBookingAccount,
  useDisconnectCalendarAccount,
  useInitiateGoogleCalendarAuth,
  useListBookingAccounts,
  useListCalendarAccounts,
} from '@/features/integrations/api';
import type {
  BookingAccount,
  CalendarAccount,
} from '@/features/integrations/types';
import { openIntegrationOAuth } from '@/lib/open-integration-oauth';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { Calendar } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

// Provider icons as simple components
const GoogleCalendarIcon = () => (
  <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <title>Google Calendar</title>
    <rect x="2" y="2" width="20" height="20" rx="2" fill="#4285F4" />
    <path d="M7 7H17V17H7V7Z" fill="white" stroke="white" />
    <path d="M7 11H17" stroke="#4285F4" strokeWidth="2" />
    <path d="M12 7V17" stroke="#4285F4" strokeWidth="2" />
  </svg>
);

const OutlookIcon = () => (
  <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <title>Outlook</title>
    <rect x="2" y="2" width="20" height="20" rx="2" fill="#0078D4" />
    <path
      d="M12 6C8.68629 6 6 8.68629 6 12C6 15.3137 8.68629 18 12 18C15.3137 18 18 15.3137 18 12C18 8.68629 15.3137 6 12 6Z"
      fill="white"
    />
  </svg>
);

const CalendlyIcon = () => (
  <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <title>Calendly</title>
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#006BFF" />
    <circle cx="12" cy="12" r="4" fill="white" />
  </svg>
);

interface Step6CalendarProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
}

export function Step6Calendar({ organizationId }: Step6CalendarProps) {
  // Fetch connected accounts - only when org exists
  const { accounts: calendarAccounts } = useListCalendarAccounts({
    queryConfig: { enabled: !!organizationId },
  });
  const { accounts: bookingAccounts } = useListBookingAccounts({
    queryConfig: { enabled: !!organizationId },
  });

  // Disconnect hooks
  const {
    disconnect: disconnectCalendar,
    isDisconnecting: isDisconnectingCalendar,
  } = useDisconnectCalendarAccount();
  const {
    disconnect: disconnectBooking,
    isDisconnecting: isDisconnectingBooking,
  } = useDisconnectBookingAccount();

  // Auth hooks with returnTo for onboarding flow
  const { initiateAuth: initiateGoogleCalendarAuth } =
    useInitiateGoogleCalendarAuth({
      returnTo: '/onboarding',
    });

  // Filter Calendly accounts from booking accounts
  const calendlyAccounts = bookingAccounts.filter(
    (a: BookingAccount) => a.provider === 'calendly'
  );

  // No org yet - show informational UI
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Link your calendar</h1>
          <p className="text-sm text-muted-foreground">
            Connect your calendar to allow the AI to book appointments directly.
            You can link multiple calendars.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <Calendar className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Calendar integrations will be available after your organization is
            created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can skip this step and set it up later in Settings.
          </p>
        </div>
      </FieldGroup>
    );
  }

  const handleCalendlyConnect = () => {
    void openIntegrationOAuth(
      'integrations/booking/auth/calendly?returnTo=/onboarding'
    );
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Link your calendar</h1>
        <p className="text-sm text-muted-foreground">
          Connect your calendar to allow the AI to book appointments directly.
          You can link multiple calendars.
        </p>
      </div>

      {/* Connected Calendars */}
      {(calendarAccounts.length > 0 || calendlyAccounts.length > 0) && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Connected Calendars</p>
          <IntegrationCardList>
            {calendarAccounts.map((account: CalendarAccount) => (
              <IntegrationCard
                key={account.id}
                id={account.id}
                provider="google_calendar"
                title={account.email}
                subtitle={account.displayName || 'Google Calendar'}
                isActive={account.isActive}
                icon={<GoogleCalendarIcon />}
                onDisconnect={() => disconnectCalendar(account.id)}
                isDisconnecting={isDisconnectingCalendar}
              />
            ))}
            {calendlyAccounts.map((account: BookingAccount) => (
              <IntegrationCard
                key={account.id}
                id={account.id}
                provider="calendly"
                title={account.email || account.displayName || 'Calendly'}
                subtitle="Calendly"
                isActive={account.isActive}
                icon={<CalendlyIcon />}
                onDisconnect={() => disconnectBooking(account.id)}
                isDisconnecting={isDisconnectingBooking}
              />
            ))}
          </IntegrationCardList>
        </div>
      )}

      {/* Calendar Provider Options */}
      <div className="space-y-3">
        <p className="text-sm font-medium">
          {calendarAccounts.length > 0
            ? 'Add another calendar'
            : 'Choose a calendar provider'}
        </p>

        <IntegrationLinkButton
          provider="google_calendar"
          label="Google Calendar"
          description="Sync with your Google Calendar"
          icon={<GoogleCalendarIcon />}
          authUrl={resolveApiUrl(
            'integrations/calendar/auth/google?returnTo=/onboarding'
          )}
          isConnected={false}
          onConnect={initiateGoogleCalendarAuth}
        />

        <IntegrationLinkButton
          provider="outlook_calendar"
          label="Outlook Calendar"
          description="Coming soon - Sync with Outlook"
          icon={<OutlookIcon />}
          authUrl="#"
          disabled
        />

        <IntegrationLinkButton
          provider="calendly"
          label="Calendly"
          description="Connect your Calendly account"
          icon={<CalendlyIcon />}
          authUrl={resolveApiUrl(
            'integrations/booking/auth/calendly?returnTo=/onboarding'
          )}
          isConnected={false}
          onConnect={handleCalendlyConnect}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        You can skip this step and set up calendars later in your organization
        settings.
      </p>
    </FieldGroup>
  );
}
