import type {
  AvailabilityBlocker,
  ExplainAvailabilityResult,
} from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import { createAvailabilityPort } from '../../ports/availability.adapter.js';
import { createResourceAvailabilityReader } from '../../ports/resource-availability.reader.js';
import { defineTool } from '../../tool-factory/index.js';

const explainAvailabilityInputSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('First date to check, YYYY-MM-DD.'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Last date to check, inclusive, YYYY-MM-DD.'),
  practitionerId: z
    .string()
    .optional()
    .describe(
      'Narrow to one team member. Omit to check the whole team. You cannot ' +
        'invent this id — only pass one you read from another tool.'
    ),
  locationId: z
    .string()
    .optional()
    .describe(
      'Needed to check OPENING HOURS. Without it the closed/open state of ' +
        'the venue is reported as unchecked rather than assumed open.'
    ),
  serviceId: z
    .string()
    .optional()
    .describe(
      'Needed to check ROOMS AND EQUIPMENT, because what a booking needs is a ' +
        'property of the SERVICE, not of the date. Pass it whenever the ' +
        'question is about a specific treatment; get the id from ' +
        'listServices. Without it, an org that gates any service on a room ' +
        'gets rooms reported as unchecked. You cannot invent this id.'
    ),
});

interface ExplainAvailabilityOutput {
  summary: string;
  bookableDates?: string[];
  /**
   * What the room/equipment check found. `applies: false` means nothing in
   * scope needs a room, so it cannot be the cause — say that rather than
   * staying silent, because "we never set rooms up" is the common case and
   * silence reads as a shrug.
   */
  resources?: { applies: boolean; categories?: string[] };
  blockers?: {
    kind: AvailabilityBlocker['kind'];
    dates: string[];
    detail?: string;
  }[];
  /** Sources that could NOT be read. Present means the answer is incomplete. */
  unchecked?: string[];
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  shifts: 'the rota',
  openingHours: 'opening hours',
  blockedTime: 'blocked time',
  timeOff: 'time off',
  resources: 'rooms and equipment',
};

/** "Room 2 and Room 3", "Room 1, Room 2 and Room 3". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * "Room 2 and Room 3 are both booked 14:00–15:00. This service needs a room,
 *  so no practitioner can take it."
 *
 * The second sentence is the point. An owner reading only the first one asks
 * why the 2pm with a free practitioner still will not book — the non-obvious
 * part of resource gating is that a room is as hard a constraint as a person.
 */
function describeResourceBlocker(
  b: Extract<AvailabilityBlocker, { kind: 'no_free_resource' }>
): string {
  const needs =
    b.categoryNoun === 'equipment'
      ? 'This service needs equipment'
      : `This service needs a ${b.categoryNoun}`;
  const consequence = `${needs}, so no practitioner can take it.`;

  if (b.contention.length === 0) {
    return `No ${b.categoryNoun} is set up that can take this service (${b.categoryName}). ${consequence}`;
  }

  const when =
    b.windows.length === 0
      ? 'all day'
      : b.windows.map((w) => `${w.from}–${w.to}`).join(' and ');

  const allClosed = b.contention.every((c) => c.closed && c.busy.length === 0);
  const names = nameList(b.contention.map((c) => c.name));
  const verb =
    b.contention.length === 1
      ? 'is'
      : b.contention.length === 2
        ? 'are both'
        : 'are all';

  const state = allClosed
    ? `${names} ${verb === 'is' ? 'is' : 'are'} closed ${when === 'all day' ? 'all day' : when}.`
    : `${names} ${verb} booked ${when}.`;

  return `${state} ${consequence}`;
}

function describeBlocker(b: AvailabilityBlocker): {
  kind: AvailabilityBlocker['kind'];
  dates: string[];
  detail?: string;
} {
  switch (b.kind) {
    case 'no_shifts':
      return {
        kind: b.kind,
        dates: b.dates,
        detail:
          'No shifts exist at all for this window. Shifts are the only thing ' +
          'that makes a service bookable, so nothing can be booked until a ' +
          'rota is set.',
      };
    case 'day_off':
      return {
        kind: b.kind,
        dates: b.dates,
        detail: 'The rota marks these days as not working.',
      };
    case 'location_closed':
      return {
        kind: b.kind,
        dates: b.dates,
        detail: 'The venue is closed on these dates.',
      };
    case 'blocked_time':
      return {
        kind: b.kind,
        dates: b.dates,
        detail: b.label
          ? `Blocked time: ${b.label}.`
          : 'Blocked time is booked over these dates.',
      };
    case 'time_off':
      return {
        kind: b.kind,
        dates: b.dates,
        detail: 'Approved time off.',
      };
    case 'no_free_resource':
      return {
        kind: b.kind,
        dates: b.dates,
        detail: describeResourceBlocker(b),
      };
  }
}

function toOutput(
  result: ExplainAvailabilityResult
): ExplainAvailabilityOutput {
  if (result.status === 'blocked') {
    return {
      summary: "I couldn't check availability.",
      error:
        result.reason.kind === 'invalid_window'
          ? result.reason.message
          : result.reason.kind === 'not_found'
            ? `That ${result.reason.what} isn't in this business.`
            : result.reason.message,
    };
  }

  const blockers = result.blockers.map(describeBlocker);
  const complete = result.status === 'read';
  const unchecked =
    result.status === 'partially_read'
      ? result.unread.map((s) => SOURCE_LABEL[s] ?? s)
      : undefined;

  // The summary NEVER says "nothing is blocking" on a partial read. An unread
  // source is a reason we did not look at, and reporting a clean result from an
  // incomplete check is the one failure this whole port exists to prevent.
  let summary: string;
  if (blockers.length === 0) {
    summary = complete
      ? `Nothing is blocking bookings between ${result.window.from} and ${result.window.to}.`
      : `I found no blockers in what I could check, but I couldn't check ${unchecked?.join(' or ')} — so I can't tell you it's clear.`;
  } else {
    summary = complete
      ? `Bookings are blocked by ${blockers.length} thing(s) in that window.`
      : `Bookings are blocked by ${blockers.length} thing(s) I could see, and I couldn't check ${unchecked?.join(' or ')}.`;
  }

  // Only surfaced when the check actually ran. On a partial read where rooms
  // were the unread source, `resources` is null and this stays absent — the
  // model is told "unchecked", never handed a shape it can read as "fine".
  const resources = result.resources
    ? result.resources.kind === 'not_applicable'
      ? { applies: false }
      : {
          applies: true,
          categories: result.resources.categories.map((c) => c.name),
        }
    : undefined;

  return {
    summary,
    bookableDates: result.bookableDates,
    ...(blockers.length > 0 ? { blockers } : {}),
    ...(unchecked ? { unchecked } : {}),
    ...(resources ? { resources } : {}),
  };
}

/**
 * `shifts_explainAvailability` — answer "why can't customers book?".
 *
 * The gap this closes, found by Gate 6: a slot can be missing for five
 * independent reasons (rota, opening hours, blocked time, time off, and — since
 * resource scheduling — no free room or machine) and Claire could read NONE of
 * them. What she had was `appointments_findOpenSlots`, which returns the RESULT
 * of that calculation — so an empty answer was a dead end rather than a
 * diagnosis, and the single most common owner question had no answer.
 *
 * Read-only, so no confirmation. The honesty lives in the port: a source that
 * could not be read comes back in `unread`, and this tool refuses to phrase an
 * incomplete check as a clean one.
 */
export const explainAvailabilityTool = defineTool<
  z.infer<typeof explainAvailabilityInputSchema>,
  ExplainAvailabilityOutput
>({
  feature: 'shifts',
  action: 'explainAvailability',
  description:
    "Explain why appointments can or can't be booked in a date range — checks " +
    'the rota, opening hours, blocked time, time off, and whether a free room ' +
    'or machine exists, and reports which of those it could not check. Use ' +
    'this whenever someone asks why there are no slots, why a service is ' +
    'unbookable, or what the team is working. Pass serviceId to include the ' +
    'room/equipment check. Read-only.',
  inputSchema: explainAvailabilityInputSchema,
  destructive: false,
  // Any member may ask why the calendar is empty — a receptionist fielding
  // "why can I not book anyone in?" is the archetypal caller. The underlying
  // routes are AuthGuard-only with no @RequireRole, so this matches them; it
  // reports rota shape and block labels, not wages or personal leave reasons.
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Checking availability' },
  additionalAllowedPaths: [
    /^shifts(\?.*)?$/,
    /^blocked-time(\?.*)?$/,
    /^time-off(\?.*)?$/,
    /^locations\/[a-zA-Z0-9_-]+\/opening-hours(\?.*)?$/,
  ],
  execute: async (input, ctx) => {
    // NOT `ctx.ports.availability`. `buildAssistantPorts` is handed the BASE
    // `apiFetch` (tool-context.ts), whose whitelist contains none of
    // shifts / blocked-time / time-off / opening-hours — so the shared port
    // would fail the path check on every read. `additionalAllowedPaths` is
    // applied only to `ctx.apiFetch`, inside a wrapped execute, so the port is
    // composed over that. Same adapter, same union.
    //
    // `update-ad.tool.ts` carries the identical workaround for the same
    // reason. The composition root can take both over the moment it threads a
    // path-extended fetch into `buildAssistantPorts`.
    //
    // The resource reader is passed here rather than composed at the root for a
    // different reason: it does not read over HTTP at all — it drives the
    // booking engine that gates the slots — and so needs the org id and time
    // zone that only a tool context carries. Omitting it would not fail loudly:
    // it would come back as an unread source, which is honest but useless.
    const availability = createAvailabilityPort({
      apiFetch: ctx.apiFetch,
      readResources: createResourceAvailabilityReader({
        organizationId: ctx.organizationId,
        timeZone: ctx.timezone,
      }),
    });
    const result = await availability.explainAvailability(input);

    if (result.status === 'blocked' && result.reason.kind === 'server_error') {
      ctx.reportIssue('Failed to read availability', {
        extra: { reason: result.reason },
      });
    }

    return { data: toOutput(result) };
  },
});
