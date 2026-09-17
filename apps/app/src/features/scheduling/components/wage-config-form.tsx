import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
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
} from '../api';
import { useGetWageConfig, useUpdateWageConfig } from '../api';

interface WageConfigFormProps {
  practitionerId: string;
  /** Called after a successful save (e.g. to close the host dialog). */
  onSaved?: () => void;
}

interface WageFormState {
  compensationType: WageCompensationType;
  hourlyRate: string;
  overtimeEnabled: boolean;
  regularWorkHours: string;
  regularWorkHoursPer: WageRegularHoursPer;
  overtimeType: WageOvertimeType;
  overtimeMultiplier: string;
  overtimeHourlyRate: string;
  autoClockIn: WageAutomationSetting;
  autoClockOut: WageAutomationSetting;
  automatedBreaks: WageAutomationSetting;
}

const DEFAULT_STATE: WageFormState = {
  compensationType: 'none',
  hourlyRate: '',
  overtimeEnabled: false,
  regularWorkHours: '',
  regularWorkHoursPer: 'week',
  overtimeType: 'multiplier',
  overtimeMultiplier: '1.5',
  overtimeHourlyRate: '',
  autoClockIn: 'workspace_default',
  autoClockOut: 'workspace_default',
  automatedBreaks: 'workspace_default',
};

function centsToInput(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? '' : String(cents / 100);
}

function inputToCents(value: string): number | null {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

/**
 * Wages tab for a team member: compensation type (none/hourly), hourly rate,
 * overtime rules and clock-in/out/break automation settings
 * (workspace default / enabled / disabled).
 */
export function WageConfigForm({
  practitionerId,
  onSaved,
}: WageConfigFormProps) {
  const { wageConfig, isLoading, isError, error } =
    useGetWageConfig(practitionerId);
  const { updateWageConfig, isSaving } = useUpdateWageConfig({
    onSuccess: onSaved,
  });

  const [state, setState] = useState<WageFormState>(DEFAULT_STATE);

  useEffect(() => {
    if (!wageConfig) return;
    setState({
      compensationType: wageConfig.compensationType,
      hourlyRate: centsToInput(wageConfig.hourlyRateCents),
      overtimeEnabled: wageConfig.overtimeEnabled,
      regularWorkHours:
        wageConfig.regularWorkHours === null
          ? ''
          : String(wageConfig.regularWorkHours),
      regularWorkHoursPer: wageConfig.regularWorkHoursPer,
      overtimeType: wageConfig.overtimeType ?? 'multiplier',
      overtimeMultiplier:
        wageConfig.overtimeMultiplier === null
          ? '1.5'
          : String(wageConfig.overtimeMultiplier),
      overtimeHourlyRate: centsToInput(wageConfig.overtimeHourlyRateCents),
      autoClockIn: wageConfig.autoClockIn,
      autoClockOut: wageConfig.autoClockOut,
      automatedBreaks: wageConfig.automatedBreaks,
    });
  }, [wageConfig]);

  const patch = (next: Partial<WageFormState>) =>
    setState((prev) => ({ ...prev, ...next }));

  const isHourly = state.compensationType === 'hourly';
  const showOvertime = isHourly && state.overtimeEnabled;

  const handleSave = () => {
    updateWageConfig({
      practitionerId,
      compensationType: state.compensationType,
      hourlyRateCents: isHourly ? inputToCents(state.hourlyRate) : null,
      overtimeEnabled: isHourly ? state.overtimeEnabled : false,
      regularWorkHours: showOvertime
        ? Number.parseFloat(state.regularWorkHours) || null
        : null,
      regularWorkHoursPer: state.regularWorkHoursPer,
      overtimeType: showOvertime ? state.overtimeType : null,
      overtimeMultiplier:
        showOvertime && state.overtimeType === 'multiplier'
          ? Number.parseFloat(state.overtimeMultiplier) || null
          : null,
      overtimeHourlyRateCents:
        showOvertime && state.overtimeType === 'hourly_rate'
          ? inputToCents(state.overtimeHourlyRate)
          : null,
      autoClockIn: state.autoClockIn,
      autoClockOut: state.autoClockOut,
      automatedBreaks: state.automatedBreaks,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-center text-sm text-destructive">
        Failed to load wage settings: {error?.message || 'Unknown error'}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      <Field>
        <FieldLabel htmlFor="wage-compensation-type">Compensation</FieldLabel>
        <Select
          value={state.compensationType}
          onValueChange={(v) =>
            patch({ compensationType: v as WageCompensationType })
          }
        >
          <SelectTrigger id="wage-compensation-type">
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
      </Field>

      {isHourly && (
        <>
          <Field>
            <FieldLabel htmlFor="wage-hourly-rate">Hourly rate</FieldLabel>
            <Input
              id="wage-hourly-rate"
              type="number"
              min={0}
              step="0.01"
              placeholder="e.g. 15.00"
              value={state.hourlyRate}
              onChange={(e) => patch({ hourlyRate: e.target.value })}
            />
          </Field>

          <div className="flex items-center justify-between rounded-md border p-3">
            <Label htmlFor="wage-overtime" className="cursor-pointer">
              Overtime
            </Label>
            <Switch
              id="wage-overtime"
              checked={state.overtimeEnabled}
              onCheckedChange={(v) => patch({ overtimeEnabled: v })}
            />
          </div>

          {showOvertime && (
            <div className="space-y-4 rounded-md border p-3">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="wage-regular-hours">
                    Regular hours
                  </FieldLabel>
                  <Input
                    id="wage-regular-hours"
                    type="number"
                    min={0}
                    max={168}
                    step="0.1"
                    placeholder="e.g. 37.5"
                    value={state.regularWorkHours}
                    onChange={(e) =>
                      patch({ regularWorkHours: e.target.value })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="wage-regular-hours-per">Per</FieldLabel>
                  <Select
                    value={state.regularWorkHoursPer}
                    onValueChange={(v) =>
                      patch({ regularWorkHoursPer: v as WageRegularHoursPer })
                    }
                  >
                    <SelectTrigger id="wage-regular-hours-per">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day</SelectItem>
                      <SelectItem value="week">Week</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="wage-overtime-type">
                    Overtime pay
                  </FieldLabel>
                  <Select
                    value={state.overtimeType}
                    onValueChange={(v) =>
                      patch({ overtimeType: v as WageOvertimeType })
                    }
                  >
                    <SelectTrigger id="wage-overtime-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="multiplier">Multiplier</SelectItem>
                      <SelectItem value="hourly_rate">Hourly rate</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                {state.overtimeType === 'multiplier' ? (
                  <Field>
                    <FieldLabel htmlFor="wage-overtime-multiplier">
                      Multiplier
                    </FieldLabel>
                    <Input
                      id="wage-overtime-multiplier"
                      type="number"
                      min={1}
                      max={10}
                      step="0.1"
                      placeholder="e.g. 1.5"
                      value={state.overtimeMultiplier}
                      onChange={(e) =>
                        patch({ overtimeMultiplier: e.target.value })
                      }
                    />
                  </Field>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="wage-overtime-rate">
                      Overtime hourly rate
                    </FieldLabel>
                    <Input
                      id="wage-overtime-rate"
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder="e.g. 22.50"
                      value={state.overtimeHourlyRate}
                      onChange={(e) =>
                        patch({ overtimeHourlyRate: e.target.value })
                      }
                    />
                  </Field>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        {(
          [
            ['autoClockIn', 'Auto clock in'],
            ['autoClockOut', 'Auto clock out'],
            ['automatedBreaks', 'Automated breaks'],
          ] as const
        ).map(([key, label]) => (
          <Field key={key}>
            <FieldLabel htmlFor={`wage-${key}`}>{label}</FieldLabel>
            <Select
              value={state[key]}
              onValueChange={(v) =>
                patch({ [key]: v as WageAutomationSetting })
              }
            >
              <SelectTrigger id={`wage-${key}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {wageAutomationSettingValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {wageAutomationSettingLabels[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ))}
      </div>

      <div className="flex justify-end">
        <Button type="button" disabled={isSaving} onClick={handleSave}>
          {isSaving ? 'Saving...' : 'Save wage settings'}
        </Button>
      </div>
    </div>
  );
}
