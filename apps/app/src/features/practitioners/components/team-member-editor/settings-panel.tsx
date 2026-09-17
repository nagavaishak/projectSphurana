import {
  permissionLevelToRole,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
} from '@borradh-workspace/api-client/types';
import { Controller, type UseFormReturn } from 'react-hook-form';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { type TeamMemberFormValues, teamMemberForm } from './types';

/** Labels come from the form declaration — see `profile-panel.tsx`. */
const L = teamMemberForm.labels;

const ROLE_DESCRIPTION: Record<string, string> = {
  low: 'Basic access — can view and manage their own calendar and appointments.',
  medium: 'Elevated access — can manage team members, services, and settings.',
  high: 'Full administrative access across the workspace.',
};

interface SettingsPanelProps {
  form: UseFormReturn<TeamMemberFormValues>;
}

export function SettingsPanel({ form }: SettingsPanelProps) {
  const { control } = form;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h3 className="text-lg font-semibold">Settings</h3>
      </div>

      <Controller
        name="acceptsBookings"
        control={control}
        render={({ field }) => (
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="pr-4">
              <Label htmlFor="tm-accepts-bookings" className="cursor-pointer">
                {L.acceptsBookings}
              </Label>
              {/*
                Says what the flag actually does. It gates the CUSTOMER-facing
                paths only — the booking page, the chatbot and the voice agent
                all resolve through `customerBookablePractitioner`. Staff-side
                booking deliberately ignores it, so someone who has stopped
                taking online bookings still holds their calendar column and can
                still be booked in by hand.
              */}
              <p className="text-sm text-muted-foreground">
                Offer this person to customers on your booking page, chatbot and
                voice agent. Your team can still book them in from the calendar
                either way.
              </p>
            </div>
            <Switch
              id="tm-accepts-bookings"
              checked={field.value}
              onCheckedChange={field.onChange}
            />
          </div>
        )}
      />

      <Field>
        <FieldLabel htmlFor="tm-permission">{L.permissionLevel}</FieldLabel>
        <Controller
          name="permissionLevel"
          control={control}
          render={({ field }) => (
            <>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="tm-permission">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {teamPermissionLevelValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {teamPermissionLevelLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                {ROLE_DESCRIPTION[field.value]} (Maps to the{' '}
                <span className="font-medium">
                  {permissionLevelToRole[field.value]}
                </span>{' '}
                org role.)
              </FieldDescription>
            </>
          )}
        />
      </Field>
    </div>
  );
}
