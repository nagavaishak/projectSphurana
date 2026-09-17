import type { PractitionerRosterResult } from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import { createPractitionersPort } from '../../ports/practitioners.adapter.js';
import { defineTool } from '../../tool-factory/index.js';

const listTeamInputSchema = z.object({
  serviceId: z
    .string()
    .optional()
    .describe(
      'Narrow to the people assigned to ONE service. You cannot invent this ' +
        'id — look the service up first. Omit to list the whole team.'
    ),
  search: z.string().optional().describe('Match part of a name, e.g. "Aoife".'),
  includeInactive: z
    .boolean()
    .optional()
    .describe(
      'Include staff who have been deactivated. Defaults to false. Ignored ' +
        'when serviceId is set — that lookup is active-only, and the answer ' +
        'says so.'
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .optional()
    .describe('Page size, 1-100. Defaults to 50.'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Page offset, for reading past the first page.'),
});

interface TeamMemberOutput {
  practitionerId: string;
  name: string;
  title?: string;
  /** False when they are deactivated or do not take bookings. */
  bookable: boolean;
  /** Omitted when the endpoint did not load the relation — absence here means
   *  UNKNOWN, never "performs no services". */
  serviceIds?: string[];
}

interface ListTeamOutput {
  summary: string;
  team?: TeamMemberOutput[];
  /** Present when more staff exist beyond what was returned. */
  more?: { nextOffset: number; hint: string };
  error?: string;
}

function toMemberOutput(m: {
  id: string;
  name: string;
  title: string | null;
  isActive: boolean;
  acceptsBookings: boolean;
  serviceIds: string[] | null;
}): TeamMemberOutput {
  return {
    practitionerId: m.id,
    name: m.name,
    ...(m.title ? { title: m.title } : {}),
    bookable: m.isActive && m.acceptsBookings,
    ...(m.serviceIds ? { serviceIds: m.serviceIds } : {}),
  };
}

function toOutput(result: PractitionerRosterResult): ListTeamOutput {
  if (result.status === 'blocked') {
    return {
      summary: "I couldn't read the team list.",
      error:
        result.reason.kind === 'not_found'
          ? "That service isn't in this business."
          : result.reason.message,
    };
  }

  const team = result.members.map(toMemberOutput);
  const forService = result.scope.kind === 'for_service';
  const unbookable = team.filter((m) => !m.bookable).length;

  let summary: string;
  if (team.length === 0) {
    summary = forService
      ? 'Nobody is currently assigned to that service, so it cannot be booked ' +
        'with anyone until someone is assigned to it.'
      : 'No team members matched.';
  } else if (forService) {
    // ASSIGNMENT, not availability. Saying "these people can do it" would
    // overstate a join-table read: whether they have a rota is a separate
    // question, and shifts_explainAvailability is what answers it.
    const notBookable =
      unbookable > 0
        ? ` ${unbookable} of them are not currently taking bookings.`
        : '';
    summary = `${team.length} active team member(s) are assigned to that service.${notBookable} This is who is assigned to it — whether they have shifts is a separate question.`;
  } else {
    summary = `${team.length} team member(s).`;
  }

  // A full page is indistinguishable from a truncated one at the API, so the
  // count is never presented as the size of the team.
  if (result.status === 'partially_read') {
    return {
      summary: `Here are the first ${result.more.returned} team members — there may be more. This is not the full count.`,
      team,
      more: {
        nextOffset: result.more.nextOffset,
        hint: `Call again with offset ${result.more.nextOffset} to read the rest.`,
      },
    };
  }

  return { summary, team };
}

/**
 * `practitioners_listTeam` — name the team, and say who performs a service.
 *
 * THE GAP, from the Gate 6 sweep. `appointments_bookAppointment` accepts a
 * `practitionerId` that NOTHING in the toolset could produce, so Claire could
 * book a person she was unable to name and reached one only as an id echoed
 * back out of an appointment she had already read. The same gap blocked
 * `shifts_explainAvailability`, whose `practitionerId` was equally
 * unobtainable. This tool is the producer for both.
 *
 * ONE TOOL, NOT TWO. "Who works here?" and "who does balayage?" are the same
 * read at two grains — the second is a filter on the first. Two tools whose
 * descriptions both begin "list staff" is the `create` vs `regenerate`
 * ambiguity the audit flagged: the model has to guess at selection time and a
 * wrong guess is silent. As one tool, the presence of `serviceId` is decided
 * by the question's own words, and the answer states which lookup actually
 * ran so a narrowed read can never be relayed as the whole roster.
 *
 * Read-only, so no confirmation.
 */
export const listPractitionersTool = defineTool<
  z.infer<typeof listTeamInputSchema>,
  ListTeamOutput
>({
  feature: 'practitioners',
  action: 'listTeam',
  description:
    'List the team — names, job titles, and the practitionerId needed to book ' +
    'someone or check their availability. Pass serviceId to see only the ' +
    'people assigned to that service. Use this whenever someone asks who ' +
    'works here, who does a particular treatment, or before booking with a ' +
    'named person. Read-only.',
  inputSchema: listTeamInputSchema,
  destructive: false,
  // The underlying GET routes carry no @RequireRole — AuthGuard + RoleGuard
  // with no role decorator is any org member, and this matches them. What is
  // returned is the booking-page fact set: name, title, and whether the person
  // is bookable. The practitioner row also holds email, phone, date of birth,
  // employment dates and internal notes; the port drops every one of them, and
  // wages live on a separate table this tool never reads. Nothing here is
  // more sensitive than the org's own "meet the team" page, so gating it to
  // admin would block a receptionist from answering "who's in on Tuesday?"
  // without protecting anything.
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Looking up the team' },
  additionalAllowedPaths: [
    /^practitioners(\?.*)?$/,
    /^practitioners\/for-service\/[a-zA-Z0-9_-]+$/,
  ],
  execute: async (input, ctx) => {
    // Composed over the tool-bound `ctx.apiFetch`, NOT `ctx.ports`. This is
    // permanent until the composition root changes, not a pending swap:
    // `buildAssistantPorts` is handed the BASE `apiFetch` (tool-context.ts),
    // and none of this tool's paths is on the base whitelist — so the shared
    // port would fail the path check on every call. `additionalAllowedPaths`
    // applies only to `ctx.apiFetch`, inside a wrapped execute.
    //
    // `update-ad.tool.ts` and `explain-availability.tool.ts` carry the same
    // workaround for the same reason. See ports/index.ts for the durable fix.
    const port = createPractitionersPort({ apiFetch: ctx.apiFetch });

    const result = input.serviceId
      ? await port.findForService({
          serviceId: input.serviceId,
          search: input.search,
        })
      : await port.listPractitioners({
          search: input.search,
          includeInactive: input.includeInactive,
          limit: input.limit,
          offset: input.offset,
        });

    if (result.status === 'blocked' && result.reason.kind === 'server_error') {
      ctx.reportIssue('Failed to read the practitioner roster', {
        extra: { reason: result.reason },
      });
    }

    return { data: toOutput(result) };
  },
});
