import {
  type NotificationPreferencesData,
  type NotificationScope,
  defaultNotificationPreferences,
  notificationCategoryLabels,
  notificationScopeLabels,
  notificationScopeValues,
} from '@borradh-workspace/api-client/types';
import { createFileRoute } from '@tanstack/react-router';
import { useId } from 'react';

import { PageShell } from '@/components/app/page-shell';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useGetNotificationPreferences } from '@/features/notifications';
import { useUpdateNotificationPreferences } from '@/features/notifications';

export const Route = createFileRoute(
  '/_authed/dashboard/settings/notifications'
)({
  component: NotificationsSettingsPage,
});

// --- Channel toggle row (Email / Push) ---

interface ChannelToggleProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}

function ChannelToggle({
  label,
  checked,
  disabled,
  onCheckedChange,
}: ChannelToggleProps) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={id} className="text-muted-foreground text-xs font-normal">
        {label}
      </Label>
      <Switch
        id={id}
        data-testid={`channel-toggle-${label.toLowerCase()}`}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

// --- Scoped category row (Appointments, Inbox handoffs, New leads, Orders) ---

interface ScopedCategoryRowProps {
  category: 'appointments' | 'inbox' | 'leads' | 'orders';
  scope: NotificationScope;
  email: boolean;
  push: boolean;
  disabled: boolean;
  separator: boolean;
  /** Hidden for categories that deliberately have no email channel. */
  showEmail?: boolean;
  onScopeChange: (scope: NotificationScope) => void;
  onEmailChange: (value: boolean) => void;
  onPushChange: (value: boolean) => void;
}

function ScopedCategoryRow({
  category,
  scope,
  email,
  push,
  disabled,
  separator,
  showEmail = true,
  onScopeChange,
  onEmailChange,
  onPushChange,
}: ScopedCategoryRowProps) {
  const scopeId = useId();
  return (
    <div className={separator ? 'border-border border-b py-4' : 'py-4'}>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={scopeId} className="font-medium text-sm">
          {notificationCategoryLabels[category]}
        </Label>
        <Select
          value={scope}
          disabled={disabled}
          onValueChange={(value) => onScopeChange(value as NotificationScope)}
        >
          <SelectTrigger id={scopeId} size="sm" className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {notificationScopeValues.map((value) => (
              <SelectItem key={value} value={value}>
                {notificationScopeLabels[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="mt-3 space-y-2">
        {showEmail && (
          <ChannelToggle
            label="Email"
            checked={email}
            disabled={disabled}
            onCheckedChange={onEmailChange}
          />
        )}
        <ChannelToggle
          label="Push"
          checked={push}
          disabled={disabled}
          onCheckedChange={onPushChange}
        />
      </div>
    </div>
  );
}

// --- Toggle category row (Ad rejections) ---

interface ToggleCategoryRowProps {
  enabled: boolean;
  email: boolean;
  push: boolean;
  disabled: boolean;
  separator: boolean;
  onEnabledChange: (value: boolean) => void;
  onEmailChange: (value: boolean) => void;
  onPushChange: (value: boolean) => void;
}

function ToggleCategoryRow({
  enabled,
  email,
  push,
  disabled,
  separator,
  onEnabledChange,
  onEmailChange,
  onPushChange,
}: ToggleCategoryRowProps) {
  const enabledId = useId();
  return (
    <div className={separator ? 'border-border border-b py-4' : 'py-4'}>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={enabledId} className="font-medium text-sm">
          {notificationCategoryLabels.advertising}
        </Label>
        <Switch
          id={enabledId}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onEnabledChange}
        />
      </div>
      <div className="mt-3 space-y-2">
        <ChannelToggle
          label="Email"
          checked={email}
          disabled={disabled || !enabled}
          onCheckedChange={onEmailChange}
        />
        <ChannelToggle
          label="Push"
          checked={push}
          disabled={disabled || !enabled}
          onCheckedChange={onPushChange}
        />
      </div>
    </div>
  );
}

// --- Legacy marketing switch row ---

interface MarketingRowProps {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  separator: boolean;
  onCheckedChange: (value: boolean) => void;
}

function MarketingRow({
  title,
  description,
  checked,
  disabled,
  separator,
  onCheckedChange,
}: MarketingRowProps) {
  const id = useId();
  return (
    <div
      className={
        separator
          ? 'flex items-center justify-between gap-4 border-border border-b py-4'
          : 'flex items-center justify-between gap-4 py-4'
      }
    >
      <div className="flex-1">
        <Label htmlFor={id} className="font-medium text-sm">
          {title}
        </Label>
        <p className="mt-0.5 text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

function NotificationsSettingsPage() {
  const { preferences, isLoading } = useGetNotificationPreferences();
  const { update, isUpdating } = useUpdateNotificationPreferences();

  if (isLoading && !preferences) {
    return (
      <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
        <title>Notifications | Borradh</title>
        <Skeleton className="h-72 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </PageShell>
    );
  }

  if (!preferences) {
    return (
      <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
        <title>Notifications | Borradh</title>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground text-sm">
            Notification preferences are unavailable right now. Please try again
            later.
          </CardContent>
        </Card>
      </PageShell>
    );
  }

  const disabled = isUpdating;
  // Granular per-category settings live in the `preferences` JSON column.
  // Start from a complete object so updates never send a partial shape.
  const prefs: NotificationPreferencesData =
    preferences.preferences ?? defaultNotificationPreferences;

  // Each handler builds the COMPLETE updated preferences object (one field
  // changed) — the API expects the full shape.
  const setScope = (
    category: 'appointments' | 'inbox' | 'leads' | 'orders',
    scope: NotificationScope
  ) => {
    update({
      preferences: {
        ...prefs,
        [category]: { ...prefs[category], scope },
      },
    });
  };

  const setScopedChannel = (
    category: 'appointments' | 'inbox' | 'leads' | 'orders',
    channel: 'email' | 'push',
    value: boolean
  ) => {
    update({
      preferences: {
        ...prefs,
        [category]: {
          ...prefs[category],
          channels: { ...prefs[category].channels, [channel]: value },
        },
      },
    });
  };

  const setAdvertisingEnabled = (enabled: boolean) => {
    update({
      preferences: {
        ...prefs,
        advertising: { ...prefs.advertising, enabled },
      },
    });
  };

  const setAdvertisingChannel = (channel: 'email' | 'push', value: boolean) => {
    update({
      preferences: {
        ...prefs,
        advertising: {
          ...prefs.advertising,
          channels: { ...prefs.advertising.channels, [channel]: value },
        },
      },
    });
  };

  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Notifications | Borradh</title>

      <Card className="gap-0 py-0">
        <CardHeader className="px-6 pt-6 pb-2">
          <CardTitle>Notifications</CardTitle>
          <CardDescription>
            Choose which events reach you and how they're delivered.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pt-2 pb-2">
          <ScopedCategoryRow
            category="appointments"
            scope={prefs.appointments.scope}
            email={prefs.appointments.channels.email}
            push={prefs.appointments.channels.push}
            disabled={disabled}
            separator
            onScopeChange={(scope) => setScope('appointments', scope)}
            onEmailChange={(v) => setScopedChannel('appointments', 'email', v)}
            onPushChange={(v) => setScopedChannel('appointments', 'push', v)}
          />
          <ScopedCategoryRow
            category="inbox"
            scope={prefs.inbox.scope}
            email={prefs.inbox.channels.email}
            push={prefs.inbox.channels.push}
            disabled={disabled}
            separator
            onScopeChange={(scope) => setScope('inbox', scope)}
            onEmailChange={(v) => setScopedChannel('inbox', 'email', v)}
            onPushChange={(v) => setScopedChannel('inbox', 'push', v)}
          />
          <ScopedCategoryRow
            category="leads"
            scope={prefs.leads.scope}
            email={prefs.leads.channels.email}
            push={prefs.leads.channels.push}
            disabled={disabled}
            separator
            showEmail={false}
            onScopeChange={(scope) => setScope('leads', scope)}
            onEmailChange={(v) => setScopedChannel('leads', 'email', v)}
            onPushChange={(v) => setScopedChannel('leads', 'push', v)}
          />
          <ScopedCategoryRow
            category="orders"
            scope={prefs.orders.scope}
            email={prefs.orders.channels.email}
            push={prefs.orders.channels.push}
            disabled={disabled}
            separator
            onScopeChange={(scope) => setScope('orders', scope)}
            onEmailChange={(v) => setScopedChannel('orders', 'email', v)}
            onPushChange={(v) => setScopedChannel('orders', 'push', v)}
          />
          <ToggleCategoryRow
            enabled={prefs.advertising.enabled}
            email={prefs.advertising.channels.email}
            push={prefs.advertising.channels.push}
            disabled={disabled}
            separator={false}
            onEnabledChange={setAdvertisingEnabled}
            onEmailChange={(v) => setAdvertisingChannel('email', v)}
            onPushChange={(v) => setAdvertisingChannel('push', v)}
          />
        </CardContent>
      </Card>

      <Card className="gap-0 py-0">
        <CardHeader className="px-6 pt-6 pb-2">
          <CardTitle>Marketing &amp; updates</CardTitle>
          <CardDescription>
            Product news and summaries — not tied to your account activity.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pt-2 pb-2">
          <MarketingRow
            title="Marketing emails"
            description="Product tips, case studies, and offers."
            checked={preferences.marketingEmails}
            disabled={disabled}
            separator
            onCheckedChange={(v) => update({ marketingEmails: v })}
          />
          <MarketingRow
            title="App updates"
            description="Major releases and new feature announcements."
            checked={preferences.appUpdates}
            disabled={disabled}
            separator
            onCheckedChange={(v) => update({ appUpdates: v })}
          />
          <MarketingRow
            title="Weekly digest"
            description="A Monday summary of bookings, leads, and Claire activity."
            checked={preferences.weeklyDigest}
            disabled={disabled}
            separator={false}
            onCheckedChange={(v) => update({ weeklyDigest: v })}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
