import { FieldGroup } from '@/components/ui/field';
import {
  IntegrationCard,
  IntegrationCardList,
} from '@/components/ui/integration-card';
import { IntegrationLinkButton } from '@/components/ui/integration-link-button';
import {
  useDisconnectCalendarAccount,
  useInitiateGoogleCalendarAuth,
  useListCalendarAccounts,
} from '@/features/integrations/api';
import type { CalendarAccount } from '@/features/integrations/types';
import { resolveApiUrl } from '@/lib/resolve-api-url';

const GoogleCalendarIcon = () => (
  <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <title>Google Calendar</title>
    <rect x="2" y="2" width="20" height="20" rx="2" fill="#4285F4" />
    <path d="M7 7H17V17H7V7Z" fill="white" stroke="white" />
    <path d="M7 11H17" stroke="#4285F4" strokeWidth="2" />
    <path d="M12 7V17" stroke="#4285F4" strokeWidth="2" />
  </svg>
);

interface StepCalendarConnectProps {
  onSaveFormState: () => void;
}

export function StepCalendarConnect({
  onSaveFormState,
}: StepCalendarConnectProps) {
  const { accounts } = useListCalendarAccounts({});

  const { disconnect, isDisconnecting } = useDisconnectCalendarAccount();

  const { initiateAuth } = useInitiateGoogleCalendarAuth({
    returnTo: '/setup-profile',
  });

  const handleConnect = () => {
    onSaveFormState();
    initiateAuth();
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Connect your calendar</h1>
        <p className="text-muted-foreground">
          Link your Google Calendar so bookings sync directly to your personal
          schedule.
        </p>
      </div>

      {accounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Connected Calendars</p>
          <IntegrationCardList>
            {accounts.map((account: CalendarAccount) => (
              <IntegrationCard
                key={account.id}
                id={account.id}
                provider="google_calendar"
                title={account.email}
                subtitle={account.displayName || 'Google Calendar'}
                isActive={account.isActive}
                icon={<GoogleCalendarIcon />}
                onDisconnect={() => disconnect(account.id)}
                isDisconnecting={isDisconnecting}
              />
            ))}
          </IntegrationCardList>
        </div>
      )}

      <IntegrationLinkButton
        provider="google_calendar"
        label={
          accounts.length > 0
            ? 'Add another Google Calendar'
            : 'Connect Google Calendar'
        }
        description="Sync bookings with your Google Calendar"
        icon={<GoogleCalendarIcon />}
        authUrl={resolveApiUrl(
          'integrations/calendar/auth/google?returnTo=/setup-profile'
        )}
        isConnected={false}
        onConnect={handleConnect}
      />

      <p className="text-xs text-muted-foreground">
        You can skip this and connect your calendar later in Settings.
      </p>
    </FieldGroup>
  );
}
