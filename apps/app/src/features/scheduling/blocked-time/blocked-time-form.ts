import { format, parse } from 'date-fns';
import { z } from 'zod';

import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { zonedEvent, zonedWallTimeToUtc } from '@/lib/timezone';
import type {
  CreateBlockedTimeInput,
  UpdateBlockedTimeInput,
} from '@borradh-workspace/api-client/types';

import { buildRRule, parseRRule } from '../lib/rrule';
import { minutesToHHmm, snapToFiveMinutes } from '../lib/time';

/**
 * SHARED CORE — blocked time.
 *
 * One zod schema + ONE pair of payload builders for the desktop dialog and the
 * mobile funnels. Both surfaces send the same fields: type preset (which
 * carries the `paid` flag), multi-practitioner selection, recurrence WITH an
 * end condition, and instants resolved in the BUSINESS timezone (never the
 * device's).
 */

export const BLOCKED_TIME_CUSTOM_TYPE = 'custom';

export const BLOCKED_TIME_FREQUENCY_OPTIONS = [
  { value: 'none', label: "Doesn't repeat" },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'Every week' },
  { value: 'monthly', label: 'Every month' },
  { value: 'custom', label: 'Custom' },
] as const;

export const BLOCKED_TIME_ENDS_OPTIONS = [
  { value: 'never', label: 'Never' },
  { value: 'on', label: 'On date' },
  { value: 'after', label: 'After occurrences' },
] as const;

export const BLOCKED_TIME_WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * ONE declaration of the blocked-time form — schema, defaults, labels and
 * controls on the same line per field. `blocked-time-fields.tsx` renders
 * `blockedTimeForm.labels.x`, so the label the user reads is the label the
 * form-contract harness locates the control by; they cannot drift.
 */
export const blockedTimeForm = defineForm({
  fields: {
    typeId: {
      schema: z.string().min(1),
      label: 'Type',
      // Desktop is a <Select>; mobile is a row of pills. Driven by the contract.
      control: 'custom',
      default: BLOCKED_TIME_CUSTOM_TYPE,
      sample: 'bt-type-1',
      sampleLabel: 'Lunch',
      // Carries `blockedTimeTypeId` AND the preset's `paid` flag onto the wire.
      derived: true,
    },
    title: {
      schema: z.string().min(1, 'Title is required').max(200),
      label: 'Title',
      control: 'text',
      default: '',
      sample: 'Team offsite',
    },
    /** yyyy-MM-dd, wall-clock in the business timezone. */
    date: {
      schema: z.string().min(1, 'Date is required'),
      label: 'Date',
      // Desktop DatePicker / mobile date row — both a popover calendar.
      control: 'custom',
      default: '',
      sample: '2026-03-05',
      // Folded with the times into the `startDate` / `endDate` instants.
      derived: true,
    },
    /** HH:mm, wall-clock in the business timezone. */
    startTime: {
      schema: z.string().min(1),
      label: 'Start time',
      control: 'custom',
      default: '09:00',
      sample: '10:00',
      derived: true,
    },
    endTime: {
      schema: z.string().min(1),
      label: 'End time',
      control: 'custom',
      default: '10:00',
      sample: '11:30',
      derived: true,
    },
    /** Empty = whole team (org-wide block). */
    practitionerIds: {
      schema: z.array(z.string()),
      label: 'Team members',
      control: 'custom',
      default: [],
      sample: ['prac-1'],
    },
    frequency: {
      schema: z.enum(['none', 'daily', 'weekly', 'monthly', 'custom']),
      label: 'Frequency',
      control: 'select',
      default: 'none',
      sample: 'custom',
      sampleLabel: 'Custom',
      // The whole recurrence block is serialized into one RRULE.
      derived: true,
    },
    customInterval: {
      schema: z.number().int().min(1).max(99),
      label: 'Every',
      control: 'number',
      default: 1,
      sample: 2,
      derived: true,
    },
    customUnit: {
      schema: z.enum(['day', 'week', 'month']),
      label: 'Unit',
      control: 'select',
      default: 'week',
      sample: 'week',
      sampleLabel: 'Week(s)',
      derived: true,
    },
    customWeekdays: {
      schema: z.array(z.number().int().min(0).max(6)),
      label: 'Repeat on',
      // A row of aria-pressed weekday toggles, not a labelled control.
      control: 'custom',
      default: [],
      sample: [1],
      derived: true,
    },
    ends: {
      schema: z.enum(['never', 'on', 'after']),
      label: 'Ends',
      control: 'select',
      default: 'never',
      sample: 'on',
      sampleLabel: 'On date',
      derived: true,
    },
    endsOnDate: {
      schema: z.string().optional(),
      label: 'End date',
      control: 'custom',
      default: '',
      sample: '2026-03-26',
      derived: true,
    },
    endsAfterCount: {
      schema: z.number().int().min(1).max(365).optional(),
      label: 'Occurrences',
      control: 'number',
      default: 1,
      sample: 3,
      derived: true,
    },
    description: {
      schema: z.string().optional(),
      label: 'Description',
      control: 'textarea',
      default: '',
      sample: 'Kept clear for the offsite.',
    },
    /**
     * this / following / all. Only rendered when EDITING a recurring
     * occurrence (`BlockedTimeScopeField`), and never carried by a create.
     */
    scope: {
      schema: z.enum(['this', 'following', 'all']),
      default: 'all',
      exempt:
        'edit-only: the field is only rendered when editing a recurring series, and a create never sends it',
    },
  },
});

export const blockedTimeFormSchema = blockedTimeForm.schema.superRefine(
  (data, ctx) => {
    if (data.endTime <= data.startTime) {
      ctx.addIssue({
        code: 'custom',
        message: 'End time must be after start time',
        path: ['endTime'],
      });
    }
    if (data.frequency !== 'none' && data.ends === 'on' && !data.endsOnDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose an end date',
        path: ['endsOnDate'],
      });
    }
    if (
      data.frequency !== 'none' &&
      data.ends === 'after' &&
      !data.endsAfterCount
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the number of occurrences',
        path: ['endsAfterCount'],
      });
    }
  }
);

export type BlockedTimeFormData = InferFormValues<typeof blockedTimeForm>;

export interface BlockedTimeEditTarget {
  /** The series id (not the expanded occurrence id). */
  id: string;
  /** RECURRENCE-ID of the occurrence being edited (recurring series only). */
  originalStart?: string;
  rrule: string | null;
  recurrenceEndDate: string | null;
  blockedTimeTypeId: string | null;
  title: string;
  description: string | null;
  startDate: string;
  endDate: string;
  practitionerIds: string[];
  paid: boolean;
}

export interface BlockedTimeInitial {
  startDate?: Date;
  startTime?: { hour: number; minute: number };
  endTime?: { hour: number; minute: number };
  practitionerId?: string;
}

/** Blocked-time type preset (drives title, duration and the `paid` flag). */
export interface BlockedTimeTypeOption {
  id: string;
  name: string;
  durationMinutes: number;
  paid: boolean;
}

export function frequencyFromRRule(rrule: string | null): {
  frequency: BlockedTimeFormData['frequency'];
  customInterval: number;
  customUnit: BlockedTimeFormData['customUnit'];
  customWeekdays: number[];
  ends: BlockedTimeFormData['ends'];
  endsOnDate?: string;
  endsAfterCount?: number;
} {
  const defaults = {
    frequency: 'none' as const,
    customInterval: 1,
    customUnit: 'week' as const,
    customWeekdays: [] as number[],
    ends: 'never' as const,
  };
  if (!rrule) return defaults;
  const parts = parseRRule(rrule);
  if (!parts) return defaults;

  const unit =
    parts.freq === 'DAILY'
      ? 'day'
      : parts.freq === 'MONTHLY'
        ? 'month'
        : 'week';
  const isSimple =
    parts.interval === 1 &&
    (parts.freq !== 'WEEKLY' || parts.byWeekdays.length <= 1);
  const frequency = isSimple
    ? parts.freq === 'DAILY'
      ? 'daily'
      : parts.freq === 'WEEKLY'
        ? 'weekly'
        : 'monthly'
    : 'custom';

  return {
    frequency,
    customInterval: parts.interval,
    customUnit: unit,
    customWeekdays: parts.byWeekdays,
    ends: parts.until ? 'on' : parts.count ? 'after' : 'never',
    endsOnDate: parts.until ? format(parts.until, 'yyyy-MM-dd') : undefined,
    endsAfterCount: parts.count ?? undefined,
  };
}

/**
 * Seed form values for create (from a calendar slot) or edit (from an existing
 * block). Times are read back in the BUSINESS timezone.
 */
export function blockedTimeDefaults({
  editing,
  initial,
  timeZone,
}: {
  editing?: BlockedTimeEditTarget | null;
  initial?: BlockedTimeInitial;
  timeZone: string;
}): BlockedTimeFormData {
  if (editing) {
    const start = zonedEvent(editing.startDate, timeZone);
    const end = zonedEvent(editing.endDate, timeZone);
    return {
      // Every key is seeded from the declaration first, so a field added there
      // can never arrive at `useForm` without a default.
      ...blockedTimeForm.defaults,
      typeId: editing.blockedTimeTypeId ?? BLOCKED_TIME_CUSTOM_TYPE,
      title: editing.title,
      date: format(start, 'yyyy-MM-dd'),
      startTime: snapToFiveMinutes(format(start, 'HH:mm')),
      endTime: snapToFiveMinutes(format(end, 'HH:mm')),
      practitionerIds: editing.practitionerIds,
      description: editing.description ?? '',
      scope: editing.rrule ? 'this' : 'all',
      ...frequencyFromRRule(editing.rrule),
    };
  }

  const base = initial?.startDate ?? new Date();
  const startMinutes = initial?.startTime
    ? initial.startTime.hour * 60 + initial.startTime.minute
    : base.getHours() * 60 + base.getMinutes();
  const endMinutes = initial?.endTime
    ? initial.endTime.hour * 60 + initial.endTime.minute
    : Math.min(startMinutes + 60, 24 * 60 - 5);

  return {
    ...blockedTimeForm.defaults,
    typeId: BLOCKED_TIME_CUSTOM_TYPE,
    title: '',
    date: format(base, 'yyyy-MM-dd'),
    startTime: snapToFiveMinutes(minutesToHHmm(startMinutes)),
    endTime: snapToFiveMinutes(minutesToHHmm(endMinutes)),
    practitionerIds: initial?.practitionerId ? [initial.practitionerId] : [],
    customWeekdays: [],
  };
}

/** Apply a type preset: it names the block and fixes its duration. */
export function applyBlockedTimeTypePreset(
  values: BlockedTimeFormData,
  type: BlockedTimeTypeOption
): Pick<BlockedTimeFormData, 'typeId' | 'title' | 'endTime'> {
  const [h, m] = values.startTime.split(':').map(Number);
  const endMinutes = Math.min(
    (h || 0) * 60 + (m || 0) + type.durationMinutes,
    24 * 60 - 5
  );
  return {
    typeId: type.id,
    title: type.name,
    endTime: minutesToHHmm(endMinutes),
  };
}

/** Wall-clock (business timezone) → real UTC instant. */
function toInstant(date: string, time: string, timeZone: string): Date {
  const [h, m] = time.split(':').map(Number);
  const day = parse(date, 'yyyy-MM-dd', new Date());
  return zonedWallTimeToUtc(day, h || 0, m || 0, timeZone);
}

interface BlockedTimeRecurrence {
  rrule: string | null;
  recurrenceEndDate: Date | null;
}

function buildRecurrence(
  data: BlockedTimeFormData,
  timeZone: string
): BlockedTimeRecurrence {
  if (data.frequency === 'none') {
    return { rrule: null, recurrenceEndDate: null };
  }

  const freq =
    data.frequency === 'custom'
      ? data.customUnit === 'day'
        ? 'DAILY'
        : data.customUnit === 'month'
          ? 'MONTHLY'
          : 'WEEKLY'
      : data.frequency === 'daily'
        ? 'DAILY'
        : data.frequency === 'monthly'
          ? 'MONTHLY'
          : 'WEEKLY';

  const until =
    data.ends === 'on' && data.endsOnDate
      ? toInstant(data.endsOnDate, '23:59', timeZone)
      : null;

  return {
    rrule: buildRRule({
      freq,
      interval: data.frequency === 'custom' ? data.customInterval : 1,
      byWeekdays:
        data.frequency === 'custom' && data.customUnit === 'week'
          ? data.customWeekdays
          : [],
      until,
      count: data.ends === 'after' ? (data.endsAfterCount ?? null) : null,
    }),
    recurrenceEndDate: until,
  };
}

/** The `paid` flag is carried by the chosen type preset; custom blocks omit it. */
export function resolveBlockedTimePaid(
  typeId: string,
  types: BlockedTimeTypeOption[]
): boolean | undefined {
  if (typeId === BLOCKED_TIME_CUSTOM_TYPE) return undefined;
  return types.find((t) => t.id === typeId)?.paid;
}

export interface BlockedTimeBuildContext {
  types: BlockedTimeTypeOption[];
  /** organization.timezone. */
  timeZone: string;
}

/** THE ONLY place a create-blocked-time API payload is constructed. */
export function buildCreateBlockedTimePayload(
  data: BlockedTimeFormData,
  { types, timeZone }: BlockedTimeBuildContext
): CreateBlockedTimeInput {
  const isCustom = data.typeId === BLOCKED_TIME_CUSTOM_TYPE;
  const { rrule, recurrenceEndDate } = buildRecurrence(data, timeZone);
  const paid = resolveBlockedTimePaid(data.typeId, types);

  return {
    blockedTimeTypeId: isCustom ? null : data.typeId,
    title: data.title,
    description: data.description?.trim() || null,
    startDate: toInstant(data.date, data.startTime, timeZone),
    endDate: toInstant(data.date, data.endTime, timeZone),
    allDay: false,
    timezone: timeZone,
    rrule,
    recurrenceEndDate,
    ...(paid !== undefined ? { paid } : {}),
    practitionerIds: data.practitionerIds,
  } as CreateBlockedTimeInput;
}

/** THE ONLY place an update-blocked-time API payload is constructed. */
export function buildUpdateBlockedTimePayload(
  data: BlockedTimeFormData,
  editing: BlockedTimeEditTarget,
  { types, timeZone }: BlockedTimeBuildContext
): UpdateBlockedTimeInput & {
  id: string;
  scope: BlockedTimeFormData['scope'];
  originalStart?: Date;
} {
  const isCustom = data.typeId === BLOCKED_TIME_CUSTOM_TYPE;
  const isRecurringSeries = !!editing.rrule;
  const scope = isRecurringSeries ? data.scope : 'all';
  // Single-occurrence edits leave the series recurrence untouched.
  const applyRecurrence = !(isRecurringSeries && scope === 'this');
  const { rrule, recurrenceEndDate } = buildRecurrence(data, timeZone);
  const paid = resolveBlockedTimePaid(data.typeId, types);

  return {
    id: editing.id,
    scope,
    ...(isRecurringSeries && editing.originalStart
      ? { originalStart: new Date(editing.originalStart) }
      : {}),
    blockedTimeTypeId: isCustom ? null : data.typeId,
    title: data.title,
    description: data.description?.trim() || null,
    startDate: toInstant(data.date, data.startTime, timeZone),
    endDate: toInstant(data.date, data.endTime, timeZone),
    ...(applyRecurrence ? { rrule, recurrenceEndDate } : {}),
    ...(paid !== undefined ? { paid } : {}),
    practitionerIds: data.practitionerIds,
  } as UpdateBlockedTimeInput & {
    id: string;
    scope: BlockedTimeFormData['scope'];
    originalStart?: Date;
  };
}
