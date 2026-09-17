/**
 * scheduling request CONTRACTS — the canonical, strict Zod schema for the BODY
 * of each scheduling write endpoint (blocked time, blocked-time types, time
 * off, shifts, wage config).
 *
 * A request contract is the wire-shaped twin of a response projection: it
 * describes exactly what the client is allowed to POST/PUT, written here in
 * pure Zod so it stays frontend-safe (no drizzle / database in the runtime
 * graph — see index.ts).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. Every feature schema under
 * `packages/features/src/scheduling/services/*` DERIVES from it by
 * `.extend()`ing the server-injected context fields onto the exported Base:
 *
 *     createBlockedTimeBaseSchema =
 *       createBlockedTimeRequestBase.extend({ organizationId, createdById })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract exports a matched pair:
 *
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()` (plus any
 *    `.refine()`). This VALIDATES a wire body: unknown keys are REJECTED, so a
 *    stale/renamed/typo'd key fails loudly instead of being silently stripped.
 *
 * DATES — `z.coerce.date()`, not `z.string().datetime()`
 * -----------------------------------------------------
 * The scheduling bodies are the one place where the two ends genuinely differ:
 * the frontend payload builders hand `Date` OBJECTS to `apiClient.post/put`
 * (which JSON-serializes them to ISO strings), while the server receives those
 * ISO strings. `z.coerce.date()` accepts BOTH and yields a `Date`, which is
 * exactly what the feature schemas already used. Keeping `z.coerce.date()` here
 * is therefore not a wire-shape compromise — it is the only choice that lets
 * the SAME schema validate the body on both ends without changing server
 * behaviour. (Contrast `appointments.ts`, whose builder emits ISO strings and
 * whose DTO coerces separately.)
 *
 * WHAT IS NOT IN THESE BODIES
 * ---------------------------
 *  - `organizationId` — from the active-org session.
 *  - `createdById`    — from `@CurrentUser('id')`.
 *  - `id`             — the route param on every update.
 *  - `practitionerId` on the shifts + wage-config routes — a route param
 *    (`PUT /shifts/weekly/:practitionerId`), NOT a body field. It IS a body
 *    field on time off (`POST /time-off`), where there is no such route param.
 *  - `scope` on blocked-time update/delete — it travels in the QUERY STRING
 *    (`?scope=this`, parsed and defaulted to `'all'` by `BlockedTimeScopePipe`),
 *    so it is not part of the body contract. `originalStart` DOES stay in the
 *    update body (the frontend builder puts it there); on DELETE it is a query
 *    param.
 *
 * ENDPOINTS WITH NO BODY (deliberately absent from this file)
 * ----------------------------------------------------------
 * `DELETE /blocked-time/:id`, `DELETE /blocked-time-types/:id`,
 * `DELETE /time-off/:id` and `DELETE /shifts/override/:practitionerId/:date`
 * carry every input in the route/query — their feature schemas are 100% context
 * fields. There is no body to contract, so there is no export for them.
 */
import {
  timeOffTypeValues,
  wageAutomationSettingValues,
  wageCompensationTypeValues,
  wageOvertimeTypeValues,
  wageRegularHoursPerValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

// ---------------------------------------------------------------- blocked time

/**
 * `POST /blocked-time` body — the EXTENDABLE half.
 *
 * Mirrors `createBlockedTimeBaseSchema` minus `organizationId` (session) and
 * `createdById` (`@CurrentUser('id')`).
 *
 * Note the `.default(…)`s: `allDay` (false), `timezone` ('UTC') and
 * `practitionerIds` ([]) MATERIALISE into the parsed body, so a client that
 * omitted them now sends them. They are kept here rather than dropped because
 * the feature schema IS this object plus context — removing a default would
 * silently change SERVER behaviour, not just client behaviour.
 */
export const createBlockedTimeRequestBase = z.object({
  blockedTimeTypeId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  allDay: z.boolean().default(false),
  timezone: z.string().min(1).default('UTC'),
  rrule: z.string().nullable().optional(),
  recurrenceEndDate: z.coerce.date().nullable().optional(),
  /** Omitted/undefined = copy from the type (or false for ad-hoc blocks). */
  paid: z.boolean().optional(),
  /** Empty = org-wide block (applies to all practitioners). */
  practitionerIds: z.array(z.string().min(1)).default([]),
});

/**
 * `POST /blocked-time` body — the VALIDATING half. The `endDate > startDate`
 * invariant is carried here so the same constraint holds for the API DTO and
 * any frontend payload builder.
 */
export const createBlockedTimeRequestSchema = createBlockedTimeRequestBase
  .strict()
  .refine((d) => d.endDate > d.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });

export type CreateBlockedTimeRequest = z.infer<
  typeof createBlockedTimeRequestSchema
>;

/**
 * `PUT /blocked-time/:id` body — the EXTENDABLE half.
 *
 * Every field is optional: an update is a patch. `id`, `organizationId`,
 * `createdById` and `scope` are all injected by the controller (`scope` from
 * `?scope=`), so they are absent here; the feature schema `.extend()`s all four
 * back on.
 */
export const updateBlockedTimeRequestBase = z.object({
  /**
   * Identifies the original occurrence being edited (RECURRENCE-ID). Required
   * by the server when scope='this'/'following' on a recurring series.
   */
  originalStart: z.coerce.date().optional(),
  blockedTimeTypeId: z.string().min(1).nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  rrule: z.string().nullable().optional(),
  recurrenceEndDate: z.coerce.date().nullable().optional(),
  paid: z.boolean().optional(),
  /** When provided, replaces the practitioner set (empty = org-wide). */
  practitionerIds: z.array(z.string().min(1)).optional(),
});

/**
 * `PUT /blocked-time/:id` body — the VALIDATING half. The date invariant is
 * conditional: a patch that moves only one end leaves the other to the server.
 */
export const updateBlockedTimeRequestSchema = updateBlockedTimeRequestBase
  .strict()
  .refine((d) => !(d.startDate && d.endDate) || d.endDate > d.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });

export type UpdateBlockedTimeRequest = z.infer<
  typeof updateBlockedTimeRequestSchema
>;

// ---------------------------------------------------------- blocked-time types

/**
 * `POST /blocked-time-types` body — the EXTENDABLE half.
 *
 * `durationMinutes` is a 5-minute-grid integer (the picker only offers those),
 * capped at 535 (8h55). `paid` defaults to false and so MATERIALISES into the
 * parsed body.
 */
export const createBlockedTimeTypeRequestBase = z.object({
  name: z.string().min(1).max(200),
  durationMinutes: z.number().int().multipleOf(5).min(5).max(535),
  paid: z.boolean().default(false),
});

/** `POST /blocked-time-types` body — the VALIDATING half. */
export const createBlockedTimeTypeRequestSchema =
  createBlockedTimeTypeRequestBase.strict();

export type CreateBlockedTimeTypeRequest = z.infer<
  typeof createBlockedTimeTypeRequestSchema
>;

/**
 * `PUT /blocked-time-types/:id` body — the EXTENDABLE half. All fields are
 * optional (patch); `id` is the route param, `organizationId` the session.
 */
export const updateBlockedTimeTypeRequestBase = z.object({
  name: z.string().min(1).max(200).optional(),
  durationMinutes: z.number().int().multipleOf(5).min(5).max(535).optional(),
  paid: z.boolean().optional(),
});

/** `PUT /blocked-time-types/:id` body — the VALIDATING half. */
export const updateBlockedTimeTypeRequestSchema =
  updateBlockedTimeTypeRequestBase.strict();

export type UpdateBlockedTimeTypeRequest = z.infer<
  typeof updateBlockedTimeTypeRequestSchema
>;

// -------------------------------------------------------------------- time off

/**
 * `POST /time-off` body — the EXTENDABLE half.
 *
 * Unlike shifts and wage config, `practitionerId` IS a body field here: the
 * route is a bare `POST /time-off` with no practitioner route param.
 *
 * Four `.default(…)`s materialise into the parsed body — `type`
 * ('annual_leave'), `allDay` (true), `timezone` ('UTC') and `approved` (true).
 */
export const createTimeOffRequestBase = z.object({
  practitionerId: z.string().min(1),
  type: z.enum(timeOffTypeValues).default('annual_leave'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  allDay: z.boolean().default(true),
  timezone: z.string().min(1).default('UTC'),
  rrule: z.string().nullable().optional(),
  recurrenceEndDate: z.coerce.date().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  approved: z.boolean().default(true),
});

/** `POST /time-off` body — the VALIDATING half. */
export const createTimeOffRequestSchema = createTimeOffRequestBase
  .strict()
  .refine((d) => d.endDate > d.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });

export type CreateTimeOffRequest = z.infer<typeof createTimeOffRequestSchema>;

/**
 * `PUT /time-off/:id` body — the EXTENDABLE half. All fields optional (patch).
 * `practitionerId` is NOT patchable: time off is not reassigned, it is deleted
 * and recreated.
 */
export const updateTimeOffRequestBase = z.object({
  type: z.enum(timeOffTypeValues).optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  allDay: z.boolean().optional(),
  timezone: z.string().min(1).optional(),
  rrule: z.string().nullable().optional(),
  recurrenceEndDate: z.coerce.date().nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  approved: z.boolean().optional(),
});

/** `PUT /time-off/:id` body — the VALIDATING half. */
export const updateTimeOffRequestSchema = updateTimeOffRequestBase
  .strict()
  .refine((d) => !(d.startDate && d.endDate) || d.endDate > d.startDate, {
    message: 'endDate must be after startDate',
    path: ['endDate'],
  });

export type UpdateTimeOffRequest = z.infer<typeof updateTimeOffRequestSchema>;

// ---------------------------------------------------------------------- shifts

/**
 * True when any two intervals overlap. Lives here rather than in
 * `packages/features` because it is a body INVARIANT, enforced by the
 * `.refine()`s below on both the client and the server; the feature schema
 * re-exports it so its existing import sites keep working.
 */
export function intervalsOverlap(
  intervals: { startMinutes: number; endMinutes: number }[]
): boolean {
  const sorted = [...intervals].sort((a, b) => a.startMinutes - b.startMinutes);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMinutes < sorted[i - 1].endMinutes) return true;
  }
  return false;
}

/**
 * One working interval, as minutes-from-midnight. 1440 is a legal END (midnight
 * of the following day); the `.refine()` is what actually forbids a
 * zero-or-negative-length interval.
 *
 * This is a `ZodEffects` (it is `.refine()`d), so it can only ever be a FIELD of
 * a contract, never a base that something extends.
 */
export const shiftIntervalRequestSchema = z
  .object({
    startMinutes: z.number().int().min(0).max(1440),
    endMinutes: z.number().int().min(0).max(1440),
  })
  .refine((d) => d.startMinutes < d.endMinutes, {
    message: 'startMinutes must be before endMinutes',
    path: ['endMinutes'],
  });

export type ShiftIntervalRequest = z.infer<typeof shiftIntervalRequestSchema>;

/**
 * `PUT /shifts/weekly/:practitionerId` body — the EXTENDABLE half.
 *
 * Replaces the practitioner's WHOLE weekly pattern: a day absent from `days` is
 * a day with no shifts, so this is a PUT and not a PATCH. Both invariants — no
 * overlapping intervals within a day, no duplicate `dayOfWeek` — are nested
 * `.refine()`s on FIELDS, which leaves the top-level object plain and therefore
 * `.extend()`able.
 */
export const setWeeklyShiftsRequestBase = z.object({
  locationId: z.string().min(1).nullable().optional(),
  days: z
    .array(
      z
        .object({
          /** 0 = Sunday … 6 = Saturday. */
          dayOfWeek: z.number().int().min(0).max(6),
          intervals: z.array(shiftIntervalRequestSchema),
        })
        .refine((d) => !intervalsOverlap(d.intervals), {
          message: 'intervals must not overlap',
          path: ['intervals'],
        })
    )
    .refine(
      (days) => new Set(days.map((d) => d.dayOfWeek)).size === days.length,
      { message: 'duplicate dayOfWeek entries' }
    ),
});

/** `PUT /shifts/weekly/:practitionerId` body — the VALIDATING half. */
export const setWeeklyShiftsRequestSchema = setWeeklyShiftsRequestBase.strict();

export type SetWeeklyShiftsRequest = z.infer<
  typeof setWeeklyShiftsRequestSchema
>;

/**
 * `PUT /shifts/override/:practitionerId` body — the EXTENDABLE half.
 *
 * A single-date override of the weekly pattern. `date` is a bare `YYYY-MM-DD`
 * calendar day, NOT an instant — deliberately a regex-checked string rather
 * than `z.coerce.date()`, because "the 5th of March at this location" has no
 * timezone and coercing it to a Date would invent one.
 *
 * `isOff` and `intervals` both default, so both materialise into the parsed
 * body.
 */
export const setShiftOverrideRequestBase = z.object({
  /** YYYY-MM-DD */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  locationId: z.string().min(1).nullable().optional(),
  isOff: z.boolean().default(false),
  intervals: z.array(shiftIntervalRequestSchema).default([]),
});

/**
 * `PUT /shifts/override/:practitionerId` body — the VALIDATING half. The three
 * `.refine()`s encode the whole meaning of an override: a day off has no
 * intervals, a working day has at least one, and they never overlap.
 */
export const setShiftOverrideRequestSchema = setShiftOverrideRequestBase
  .strict()
  .refine((d) => !d.isOff || d.intervals.length === 0, {
    message: 'intervals must be empty when isOff is true',
    path: ['intervals'],
  })
  .refine((d) => d.isOff || d.intervals.length > 0, {
    message: 'at least one interval is required when isOff is false',
    path: ['intervals'],
  })
  .refine((d) => !intervalsOverlap(d.intervals), {
    message: 'intervals must not overlap',
    path: ['intervals'],
  });

export type SetShiftOverrideRequest = z.infer<
  typeof setShiftOverrideRequestSchema
>;

// ----------------------------------------------------------------- wage config

/**
 * `PUT /wage-configs/:practitionerId` body — the EXTENDABLE half.
 *
 * An upsert-shaped patch: every field is optional, and the ones that model "not
 * configured" are `.nullable()` as well as `.optional()` — `null` CLEARS the
 * stored value, `undefined` LEAVES IT ALONE. That distinction is load-bearing
 * and is why they are not collapsed to a single optional.
 *
 * Money is integer cents; there are no floats on this wire.
 */
export const updateWageConfigRequestBase = z.object({
  compensationType: z.enum(wageCompensationTypeValues).optional(),
  hourlyRateCents: z.number().int().min(0).nullable().optional(),
  overtimeEnabled: z.boolean().optional(),
  regularWorkHours: z.number().positive().max(168).nullable().optional(),
  regularWorkHoursPer: z.enum(wageRegularHoursPerValues).optional(),
  overtimeType: z.enum(wageOvertimeTypeValues).nullable().optional(),
  overtimeMultiplier: z.number().positive().max(10).nullable().optional(),
  overtimeHourlyRateCents: z.number().int().min(0).nullable().optional(),
  autoClockIn: z.enum(wageAutomationSettingValues).optional(),
  autoClockOut: z.enum(wageAutomationSettingValues).optional(),
  automatedBreaks: z.enum(wageAutomationSettingValues).optional(),
  /** Proximity/location restriction (50m) — stored now, enforced later (P3). */
  locationRestriction: z.enum(wageAutomationSettingValues).optional(),
});

/** `PUT /wage-configs/:practitionerId` body — the VALIDATING half. */
export const updateWageConfigRequestSchema =
  updateWageConfigRequestBase.strict();

export type UpdateWageConfigRequest = z.infer<
  typeof updateWageConfigRequestSchema
>;
