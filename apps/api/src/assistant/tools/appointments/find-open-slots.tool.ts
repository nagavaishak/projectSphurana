import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { resolveToolDate } from '../_shared/resolve-tool-date.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

/**
 * `POST /appointments/open-slots` — `CheckAvailabilityResult`.
 *
 * Fully computed (merged provider/shift availability, no backing table), so
 * there is no atom to anchor to and no projection in
 * `packages/contracts/src/responses/`; the shape is hand-modelled from
 * `check-availability.schema.ts`.
 *
 * `practitionerId` / `practitionerName` are OPTIONAL and were missing from the
 * interface this replaces. They only appear on the shift-based path, and the
 * tool passes slots through verbatim — so omitting them from the parse would
 * have silently stripped the one field that says WHO the slot belongs to.
 */
const availableSlotSchema = z.object({
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  displayTime: z.string(),
  isoStart: z.string(),
  isoEnd: z.string(),
  practitionerId: z.string().optional(),
  practitionerName: z.string().optional(),
});

const findOpenSlotsResponseSchema = z.object({
  available: z.boolean(),
  slots: z.array(availableSlotSchema),
  provider: z.string(),
  message: z.string(),
});

type FindOpenSlotsOutput = z.infer<typeof findOpenSlotsResponseSchema> & {
  /** The absolute date the query resolved to (org timezone). Echoed so a
   *  misresolved relative expression is visible and assertable. */
  queryDate: string;
};

/**
 * `appointments_findOpenSlots` — find open appointment slots for a single date.
 *
 * Wraps `POST /appointments/open-slots` (which internally calls the calendar
 * feature's `checkAvailability` service). Single-day for v3; multi-day
 * aggregation is a follow-up flagged in the C-07 brief.
 */
export const findOpenSlotsTool = defineTool<
  {
    date: string;
    duration?: number;
    serviceId?: string;
    timePreference?: 'morning' | 'afternoon' | 'evening' | 'any';
    timezone?: string;
  },
  FindOpenSlotsOutput
>({
  feature: 'appointments',
  action: 'findOpenSlots',
  description:
    'Find open appointment slots for a single date. Optionally narrow by ' +
    'service (which constrains practitioners), duration in minutes, and ' +
    'time-of-day preference. Returns slot start/end times in the org ' +
    'timezone. Single-day only — call again per date if the user wants to ' +
    'see multiple days.',
  inputSchema: z.object({
    date: z
      .string()
      .min(1)
      .describe(
        "The day to search. Pass the user's words verbatim — an ISO date " +
          '("2026-08-07") or a relative phrase ("today", "tomorrow", "next ' +
          'Friday"). The server resolves it against the real clock in the org ' +
          'timezone; do NOT compute a date yourself. Single day only.'
      ),
    duration: z
      .number()
      .int()
      .min(15)
      .max(480)
      .optional()
      .describe(
        'Slot duration in minutes (15–480). Defaults vary per provider.'
      ),
    serviceId: z
      .string()
      .optional()
      .describe(
        'Optional service ID. When set, filters to practitioners offering this service.'
      ),
    timePreference: z
      .enum(['morning', 'afternoon', 'evening', 'any'])
      .optional()
      .describe('Preferred time-of-day band. Defaults to "any".'),
    timezone: z
      .string()
      .optional()
      .describe(
        'IANA timezone (e.g. Europe/Dublin). Defaults to UTC; pass the org timezone when known.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Finding open slots' },
  additionalAllowedPaths: APPOINTMENTS_PATH_PATTERNS,
  execute: async (input, ctx) => {
    // Phase 3: resolve the model's date EXPRESSION server-side, in the org
    // timezone, from the real clock (register #208 — "tomorrow" was resolved
    // against the model's 2025 training prior into a past year). The org zone
    // (`ctx.timezone`) is authoritative; the model's optional `timezone` input
    // is only a fallback for an explicitly different zone.
    const timezone = ctx.timezone || input.timezone || 'UTC';
    const queryDate = resolveToolDate(input.date, timezone);
    const data = await ctx.apiFetch('appointments/open-slots', {
      schema: findOpenSlotsResponseSchema,
      method: 'POST',
      body: { ...input, date: queryDate, timezone },
    });
    return {
      data: {
        available: data.available,
        slots: data.slots,
        provider: data.provider,
        message: data.message,
        // Echo the resolved absolute date so a misresolution is visible.
        queryDate,
      },
    };
  },
});
