import {
  wageAutomationSettingLabels,
  wageAutomationSettingValues,
  wageCompensationTypeLabels,
  wageCompensationTypeValues,
} from '@borradh-workspace/api-client/types';
import type {
  WageAutomationSetting,
  WageCompensationType,
  WageOvertimeType,
  WageRegularHoursPer,
} from '@borradh-workspace/api-client/types';
import { Controller, type UseFormReturn } from 'react-hook-form';

import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useUpdateWageConfig } from '@/features/scheduling';
import { WageConfigForm } from '@/features/scheduling';

import { type TeamMemberFormValues, teamMemberForm } from './types';

/** Labels come from the form declaration — see `profile-panel.tsx`. */
const L = teamMemberForm.labels;

const RESTRICTION_NOTE =
  'Requires the team member to clock in within 50m of their location. ' +
  'Enforcement is not live yet — this setting is stored for a future release.';

/** Number input with a hardcoded currency symbol rendered inside the field. */
function CurrencyInput({
  id,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        €
      </span>
      <Input
        id={id}
        type="number"
        min={0}
        step="0.01"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pl-7"
      />
    </div>
  );
}

function LocationRestrictionSelect({
  value,
  onChange,
  id,
}: {
  value: WageAutomationSetting;
  onChange: (value: WageAutomationSetting) => void;
  id: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>Location restrictions</FieldLabel>
      <Select
        value={value}
        onValueChange={(v) => onChange(v as WageAutomationSetting)}
      >
        <SelectTrigger id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {wageAutomationSettingValues.map((setting) => (
            <SelectItem key={setting} value={setting}>
              {wageAutomationSettingLabels[setting]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <FieldDescription>{RESTRICTION_NOTE}</FieldDescription>
    </Field>
  );
}

interface WagesPanelProps {
  form: UseFormReturn<TeamMemberFormValues>;
  /** Present in edit mode — reuse the self-saving WageConfigForm. */
  practitionerId?: string;
}

export function WagesPanel({ form, practitionerId }: WagesPanelProps) {
  const { control, watch } = form;
  const compensationType = watch('wage.compensationType');
  const overtimeEnabled = watch('wage.overtimeEnabled');
  const overtimeType = watch('wage.overtimeType');
  const isHourly = compensationType === 'hourly';
  const showOvertime = isHourly && overtimeEnabled;

  const { updateWageConfig } = useUpdateWageConfig();

  // Edit mode: reuse the existing WageConfigForm (self-saving), and expose the
  // net-new location-restriction row wired to the same wage-config endpoint.
  if (practitionerId) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h3 className="text-lg font-semibold">{L.wage}</h3>
        </div>
        <WageConfigForm practitionerId={practitionerId} />
        <div className="rounded-lg border p-4">
          <Controller
            name="wage.locationRestriction"
            control={control}
            render={({ field }) => (
              <LocationRestrictionSelect
                id="tm-wage-location-restriction"
                value={field.value}
                onChange={(v) => {
                  field.onChange(v);
                  updateWageConfig({ practitionerId, locationRestriction: v });
                }}
              />
            )}
          />
        </div>
      </div>
    );
  }

  // Create mode: capture wage config into the composite payload.
  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <div>
        <h3 className="text-lg font-semibold">{L.wage}</h3>
      </div>

      <Field>
        <FieldLabel htmlFor="tm-wage-compensation">Compensation</FieldLabel>
        <Controller
          name="wage.compensationType"
          control={control}
          render={({ field }) => (
            <Select
              value={field.value}
              onValueChange={(v) => field.onChange(v as WageCompensationType)}
            >
              <SelectTrigger id="tm-wage-compensation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {wageCompensationTypeValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {wageCompensationTypeLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      {isHourly && (
        <>
          <Field>
            <FieldLabel htmlFor="tm-wage-rate">Hourly rate</FieldLabel>
            <Controller
              name="wage.hourlyRate"
              control={control}
              render={({ field }) => (
                <CurrencyInput
                  id="tm-wage-rate"
                  placeholder="e.g. 15.00"
                  value={field.value}
                  onChange={field.onChange}
                />
              )}
            />
          </Field>

          <Controller
            name="wage.overtimeEnabled"
            control={control}
            render={({ field }) => (
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="tm-wage-overtime" className="cursor-pointer">
                  Overtime
                </Label>
                <Switch
                  id="tm-wage-overtime"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />

          {showOvertime && (
            <div className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="tm-wage-regular-hours">
                  Regular hours
                </FieldLabel>
                <Controller
                  name="wage.regularWorkHours"
                  control={control}
                  render={({ field }) => (
                    <Input
                      id="tm-wage-regular-hours"
                      type="number"
                      min={0}
                      max={168}
                      step="0.1"
                      placeholder="e.g. 40"
                      value={field.value}
                      onChange={field.onChange}
                    />
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tm-wage-regular-per">Per</FieldLabel>
                <Controller
                  name="wage.regularWorkHoursPer"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as WageRegularHoursPer)
                      }
                    >
                      <SelectTrigger id="tm-wage-regular-per">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="day">Day</SelectItem>
                        <SelectItem value="week">Week</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="tm-wage-overtime-type">
                  Overtime pay
                </FieldLabel>
                <Controller
                  name="wage.overtimeType"
                  control={control}
                  render={({ field }) => (
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as WageOvertimeType)
                      }
                    >
                      <SelectTrigger id="tm-wage-overtime-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="multiplier">Multiplier</SelectItem>
                        <SelectItem value="hourly_rate">Hourly rate</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              {overtimeType === 'multiplier' ? (
                <Field>
                  <FieldLabel htmlFor="tm-wage-multiplier">
                    Multiplier
                  </FieldLabel>
                  <Controller
                    name="wage.overtimeMultiplier"
                    control={control}
                    render={({ field }) => (
                      <Input
                        id="tm-wage-multiplier"
                        type="number"
                        min={1}
                        max={10}
                        step="0.1"
                        placeholder="e.g. 1.5"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </Field>
              ) : (
                <Field>
                  <FieldLabel htmlFor="tm-wage-overtime-rate">
                    Overtime hourly rate
                  </FieldLabel>
                  <Controller
                    name="wage.overtimeHourlyRate"
                    control={control}
                    render={({ field }) => (
                      <CurrencyInput
                        id="tm-wage-overtime-rate"
                        placeholder="e.g. 22.50"
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </Field>
              )}
            </div>
          )}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['wage.autoClockIn', 'Auto clock in', 'tm-wage-auto-in'],
            ['wage.autoClockOut', 'Auto clock out', 'tm-wage-auto-out'],
            ['wage.automatedBreaks', 'Automated breaks', 'tm-wage-breaks'],
          ] as const
        ).map(([name, label, id]) => (
          <Field key={name}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Controller
              name={name}
              control={control}
              render={({ field }) => (
                <Select
                  value={field.value}
                  onValueChange={(v) =>
                    field.onChange(v as WageAutomationSetting)
                  }
                >
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {wageAutomationSettingValues.map((setting) => (
                      <SelectItem key={setting} value={setting}>
                        {wageAutomationSettingLabels[setting]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
        ))}
      </div>

      <Controller
        name="wage.locationRestriction"
        control={control}
        render={({ field }) => (
          <LocationRestrictionSelect
            id="tm-wage-location-restriction"
            value={field.value}
            onChange={field.onChange}
          />
        )}
      />
    </div>
  );
}
