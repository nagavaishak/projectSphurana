import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { IntegrationSettingsDialog } from './integration-settings-dialog';

interface OutlookCalendarSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (data: { accountId: string; calendarId: string }) => void;
  onDisconnect?: () => void;
  defaultValues?: {
    accountId?: string;
    calendarId?: string;
  };
  accounts?: { id: string; email: string }[];
  calendars?: { id: string; name: string }[];
}

export function OutlookCalendarSettingsDialog({
  open,
  onOpenChange,
  onSave,
  onDisconnect,
  defaultValues,
  accounts = [],
  calendars = [],
}: OutlookCalendarSettingsDialogProps) {
  const [accountId, setAccountId] = useState(defaultValues?.accountId ?? '');
  const [calendarId, setCalendarId] = useState(defaultValues?.calendarId ?? '');

  const handleSave = () => {
    onSave?.({ accountId, calendarId });
  };

  return (
    <IntegrationSettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Outlook Calendar"
      icon={
        <img
          src="/outlook-icon.svg"
          alt="Outlook Calendar"
          className="size-10"
        />
      }
      onSave={handleSave}
      onDisconnect={onDisconnect}
    >
      <Field>
        <FieldLabel>Connected Account</FieldLabel>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Selected Calendar</FieldLabel>
        <Select value={calendarId} onValueChange={setCalendarId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a calendar" />
          </SelectTrigger>
          <SelectContent>
            {calendars.map((calendar) => (
              <SelectItem key={calendar.id} value={calendar.id}>
                {calendar.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </IntegrationSettingsDialog>
  );
}
