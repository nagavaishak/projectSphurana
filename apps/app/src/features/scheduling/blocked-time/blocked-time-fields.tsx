import { format, parse } from 'date-fns';
import { Check, ChevronsUpDown } from 'lucide-react';
import { Controller, type UseFormReturn } from 'react-hook-form';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  MOBILE_INPUT_CLASS,
  MOBILE_SELECT_TRIGGER_CLASS,
  MOBILE_TEXTAREA_CLASS,
  MobileDateRow,
  MobileSelectionPill,
  MobileTimePickerRow,
} from '@/features/mobile-ui';
import { cn } from '@/lib/utils';

import { TimeSelect } from '../components/time-select';

import {
  BLOCKED_TIME_CUSTOM_TYPE,
  BLOCKED_TIME_ENDS_OPTIONS,
  BLOCKED_TIME_FREQUENCY_OPTIONS,
  BLOCKED_TIME_WEEKDAY_LABELS,
  type BlockedTimeFormData,
  type BlockedTimeTypeOption,
  applyBlockedTimeTypePreset,
  blockedTimeForm,
} from './blocked-time-form';
import type { BlockedTimePractitionerOption } from './use-blocked-time-context';

/**
 * SHARED FIELDS — blocked time. Desktop composes these into its dialog; the
 * mobile funnel composes the SAME fields (variant="mobile") across its steps.
 * The value written to the form is identical either way.
 *
 * Every label comes from `blockedTimeForm.labels` — the same declaration the
 * schema and the defaults come from — so the string the user reads and the one
 * the form-contract harness locates the control by cannot drift apart.
 */
const L = blockedTimeForm.labels;

export type BlockedTimeFieldVariant = 'desktop' | 'mobile';

interface BaseProps {
  form: UseFormReturn<BlockedTimeFormData>;
  variant?: BlockedTimeFieldVariant;
}

function formatDisplayDate(value: string): string {
  const parsed = parse(value, 'yyyy-MM-dd', new Date());
  return Number.isNaN(parsed.getTime()) ? value : format(parsed, 'EEE d MMM');
}

/**
 * Type preset. Selecting one names the block, fixes its duration, and — crucially
 * — carries the `paid` flag into the payload. Mobile used to hard-send `null`
 * here, which made `paid` unreachable on a phone.
 */
export function BlockedTimeTypeField({
  form,
  types,
  variant = 'desktop',
}: BaseProps & { types: BlockedTimeTypeOption[] }) {
  const applyPreset = (typeId: string) => {
    if (typeId === BLOCKED_TIME_CUSTOM_TYPE) {
      form.setValue('typeId', BLOCKED_TIME_CUSTOM_TYPE);
      return;
    }
    const preset = types.find((t) => t.id === typeId);
    if (!preset) {
      form.setValue('typeId', typeId);
      return;
    }
    const next = applyBlockedTimeTypePreset(form.getValues(), preset);
    form.setValue('typeId', next.typeId);
    form.setValue('title', next.title);
    form.setValue('endTime', next.endTime);
  };

  return (
    <Controller
      name="typeId"
      control={form.control}
      render={({ field }) => {
        if (variant === 'mobile') {
          return (
            <section>
              <p className="pb-2 text-[13px] text-[#8E8E93]">{L.typeId}</p>
              <div className="flex flex-wrap gap-2">
                <MobileSelectionPill
                  label="Custom"
                  selected={field.value === BLOCKED_TIME_CUSTOM_TYPE}
                  onClick={() => applyPreset(BLOCKED_TIME_CUSTOM_TYPE)}
                />
                {types.map((type) => (
                  <MobileSelectionPill
                    key={type.id}
                    label={type.name}
                    selected={field.value === type.id}
                    onClick={() => applyPreset(type.id)}
                  />
                ))}
              </div>
            </section>
          );
        }

        return (
          <Field>
            <FieldLabel htmlFor={field.name}>{L.typeId}</FieldLabel>
            <Select value={field.value} onValueChange={applyPreset}>
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={BLOCKED_TIME_CUSTOM_TYPE}>Custom</SelectItem>
                {types.map((type) => (
                  <SelectItem key={type.id} value={type.id}>
                    {type.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      }}
    />
  );
}

export function BlockedTimeTitleField({
  form,
  variant = 'desktop',
}: BaseProps) {
  return (
    <Controller
      name="title"
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{L.title}</FieldLabel>
          <Input
            {...field}
            id={field.name}
            placeholder="e.g. Lunch, Meeting"
            aria-invalid={fieldState.invalid}
            className={cn(variant === 'mobile' && MOBILE_INPUT_CLASS)}
          />
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

/** Date + start/end time. */
export function BlockedTimeWhenFields({
  form,
  variant = 'desktop',
}: BaseProps) {
  if (variant === 'mobile') {
    return (
      <section>
        <p className="pb-2 text-[13px] text-[#8E8E93]">When</p>
        <div className="divide-y divide-[#E5E5EA] overflow-hidden rounded-xl border border-[#E5E5EA]">
          <Controller
            name="date"
            control={form.control}
            render={({ field }) => (
              <MobileDateRow
                value={formatDisplayDate(field.value)}
                selected={parse(field.value, 'yyyy-MM-dd', new Date())}
                onSelect={(date) => field.onChange(format(date, 'yyyy-MM-dd'))}
              />
            )}
          />
          <Controller
            name="startTime"
            control={form.control}
            render={({ field }) => (
              <MobileTimePickerRow
                label="Start"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <Controller
            name="endTime"
            control={form.control}
            render={({ field }) => (
              <MobileTimePickerRow
                label="End"
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
        {form.formState.errors.endTime ? (
          <FieldError
            errors={[form.formState.errors.endTime]}
            className="pt-1.5"
          />
        ) : null}
      </section>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-3">
      <Controller
        name="date"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>{L.date}</FieldLabel>
            <DatePicker
              id={field.name}
              placeholder="Select date"
              value={
                field.value
                  ? parse(field.value, 'yyyy-MM-dd', new Date())
                  : undefined
              }
              onChange={(date) =>
                field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
              }
              aria-invalid={fieldState.invalid}
            />
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
      <Controller
        name="startTime"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>{L.startTime}</FieldLabel>
            <TimeSelect
              id={field.name}
              value={field.value}
              onChange={field.onChange}
              aria-invalid={fieldState.invalid}
            />
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
      <Controller
        name="endTime"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>{L.endTime}</FieldLabel>
            <TimeSelect
              id={field.name}
              value={field.value}
              onChange={field.onChange}
              aria-invalid={fieldState.invalid}
            />
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
    </div>
  );
}

/** Multi-practitioner selection. Empty = whole team (org-wide block). */
export function BlockedTimePractitionersField({
  form,
  options,
  variant = 'desktop',
}: BaseProps & { options: BlockedTimePractitionerOption[] }) {
  return (
    <Controller
      name="practitionerIds"
      control={form.control}
      render={({ field }) => {
        const toggle = (id: string) =>
          field.onChange(
            field.value.includes(id)
              ? field.value.filter((v) => v !== id)
              : [...field.value, id]
          );

        if (variant === 'mobile') {
          return (
            <section>
              <p className="pb-2 text-[13px] text-[#8E8E93]">
                {L.practitionerIds}
              </p>
              <div className="flex flex-wrap gap-2">
                <MobileSelectionPill
                  label="Whole team"
                  selected={field.value.length === 0}
                  onClick={() => field.onChange([])}
                />
                {options.map((option) => (
                  <MobileSelectionPill
                    key={option.id}
                    label={option.name}
                    selected={field.value.includes(option.id)}
                    onClick={() => toggle(option.id)}
                  />
                ))}
              </div>
            </section>
          );
        }

        return (
          <Field>
            <FieldLabel htmlFor={field.name}>{L.practitionerIds}</FieldLabel>
            <PractitionerMultiSelect
              id={field.name}
              value={field.value}
              onChange={field.onChange}
              options={options}
            />
          </Field>
        );
      }}
    />
  );
}

/**
 * Recurrence: frequency, optional custom rule, and — always — an END condition
 * (never / on date / after N). Mobile's old canned RRULEs had no UNTIL or COUNT,
 * which created infinite series.
 */
export function BlockedTimeRecurrenceFields({
  form,
  variant = 'desktop',
}: BaseProps) {
  const frequency = form.watch('frequency');
  const ends = form.watch('ends');
  const customUnit = form.watch('customUnit');
  const isMobile = variant === 'mobile';

  return (
    <>
      <Controller
        name="frequency"
        control={form.control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={field.name}>{L.frequency}</FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger
                id={field.name}
                className={cn(isMobile && MOBILE_SELECT_TRIGGER_CLASS)}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BLOCKED_TIME_FREQUENCY_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      />

      {frequency === 'custom' && (
        <div className="space-y-3 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="customInterval"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.customInterval}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    max={99}
                    value={field.value}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value)
                      )
                    }
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                    aria-invalid={fieldState.invalid}
                    className={cn(isMobile && MOBILE_INPUT_CLASS)}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="customUnit"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{L.customUnit}</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger
                      id={field.name}
                      className={cn(isMobile && MOBILE_SELECT_TRIGGER_CLASS)}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="day">Day(s)</SelectItem>
                      <SelectItem value="week">Week(s)</SelectItem>
                      <SelectItem value="month">Month(s)</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>

          {customUnit === 'week' && (
            <Controller
              name="customWeekdays"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel>{L.customWeekdays}</FieldLabel>
                  <div className="flex gap-1.5">
                    {BLOCKED_TIME_WEEKDAY_LABELS.map((label, day) => {
                      const active = field.value.includes(day);
                      return (
                        <Button
                          key={`${label}-${day}`}
                          type="button"
                          size="icon"
                          variant={active ? 'default' : 'outline'}
                          className="size-8 rounded-full text-xs"
                          aria-pressed={active}
                          onClick={() =>
                            field.onChange(
                              active
                                ? field.value.filter((d) => d !== day)
                                : [...field.value, day]
                            )
                          }
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                </Field>
              )}
            />
          )}
        </div>
      )}

      {frequency !== 'none' && (
        <div
          className={cn(
            !isMobile && 'grid grid-cols-2 gap-3',
            isMobile && 'flex flex-col gap-3'
          )}
        >
          <Controller
            name="ends"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={field.name}>{L.ends}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={field.name}
                    className={cn(isMobile && MOBILE_SELECT_TRIGGER_CLASS)}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BLOCKED_TIME_ENDS_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          {ends === 'on' && (
            <Controller
              name="endsOnDate"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{L.endsOnDate}</FieldLabel>
                  <DatePicker
                    id={field.name}
                    placeholder="Select date"
                    value={
                      field.value
                        ? parse(field.value, 'yyyy-MM-dd', new Date())
                        : undefined
                    }
                    onChange={(date) =>
                      field.onChange(
                        date ? format(date, 'yyyy-MM-dd') : undefined
                      )
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          )}
          {ends === 'after' && (
            <Controller
              name="endsAfterCount"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.endsAfterCount}
                  </FieldLabel>
                  <Input
                    id={field.name}
                    type="number"
                    min={1}
                    max={365}
                    value={field.value ?? ''}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === ''
                          ? undefined
                          : Number(e.target.value)
                      )
                    }
                    onBlur={field.onBlur}
                    name={field.name}
                    ref={field.ref}
                    aria-invalid={fieldState.invalid}
                    className={cn(isMobile && MOBILE_INPUT_CLASS)}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          )}
        </div>
      )}
    </>
  );
}

export function BlockedTimeDescriptionField({
  form,
  variant = 'desktop',
}: BaseProps) {
  return (
    <Controller
      name="description"
      control={form.control}
      render={({ field }) => (
        <Field>
          <FieldLabel htmlFor={field.name}>{L.description}</FieldLabel>
          <Textarea
            {...field}
            id={field.name}
            placeholder="Optional notes"
            rows={variant === 'mobile' ? 4 : 2}
            className={cn(variant === 'mobile' && MOBILE_TEXTAREA_CLASS)}
          />
        </Field>
      )}
    />
  );
}

/** this / following / all — shown when editing a recurring occurrence. */
export function BlockedTimeScopeField({ form }: BaseProps) {
  return (
    <Controller
      name="scope"
      control={form.control}
      render={({ field }) => (
        <Field>
          <FieldLabel>Apply changes to</FieldLabel>
          <RadioGroup value={field.value} onValueChange={field.onChange}>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="this" id="bt-scope-this" />
              <Label htmlFor="bt-scope-this" className="cursor-pointer">
                This occurrence only
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="following" id="bt-scope-following" />
              <Label htmlFor="bt-scope-following" className="cursor-pointer">
                This and following occurrences
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="all" id="bt-scope-all" />
              <Label htmlFor="bt-scope-all" className="cursor-pointer">
                All occurrences
              </Label>
            </div>
          </RadioGroup>
        </Field>
      )}
    />
  );
}

/**
 * Desktop multi-select for practitioners; empty selection = whole team,
 * mirroring the backend contract (zero join rows = org-wide block).
 */
function PractitionerMultiSelect({
  id,
  value,
  onChange,
  options,
}: {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: BlockedTimePractitionerOption[];
}) {
  const summary =
    value.length === 0
      ? 'Whole team'
      : value.length <= 2
        ? options
            .filter((o) => value.includes(o.id))
            .map((o) => o.name)
            .join(', ')
        : `${value.length} team members`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-between font-normal"
        >
          <span className="truncate">{summary}</span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-2">
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted',
            value.length === 0 && 'font-medium'
          )}
          onClick={() => onChange([])}
        >
          <Check
            className={cn(
              'size-4',
              value.length === 0 ? 'opacity-100' : 'opacity-0'
            )}
          />
          Whole team
        </button>
        <div className="my-1 border-t" />
        <div className="max-h-56 space-y-0.5 overflow-y-auto">
          {options.map((option) => {
            const checked = value.includes(option.id);
            return (
              <label
                key={option.id}
                htmlFor={`bt-practitioner-${option.id}`}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              >
                <Checkbox
                  id={`bt-practitioner-${option.id}`}
                  checked={checked}
                  onCheckedChange={(next) =>
                    onChange(
                      next === true
                        ? [...value, option.id]
                        : value.filter((v) => v !== option.id)
                    )
                  }
                />
                <span className="truncate">{option.name}</span>
              </label>
            );
          })}
          {options.length === 0 && (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No team members yet
            </p>
          )}
        </div>
        {value.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {options
              .filter((o) => value.includes(o.id))
              .map((o) => (
                <Badge key={o.id} variant="secondary" className="text-xs">
                  {o.name}
                </Badge>
              ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
