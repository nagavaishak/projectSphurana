import {
  listPractitionersResponseSchema,
  practitionersForServiceResponseSchema,
} from '@borradh-workspace/contracts';
import type {
  ListPractitionersResponseShape,
  PractitionerWithRelationsResponse,
  PractitionersForServiceResponse,
} from '@borradh-workspace/contracts';
import type {
  FindPractitionersForServiceInput,
  ListPractitionersInput,
  PractitionerRosterResult,
  PractitionersPort,
  RosterScope,
  TeamMember,
} from '@borradh-workspace/contracts/ports';
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

export interface PractitionersPortDeps {
  apiFetch: ApiFetchFn;
}

/**
 * A 4xx is the API stating a reason; anything else is the server breaking.
 * Only the fault side may reach Sentry — collapsing the two is what made
 * ordinary "no, because…" answers page someone.
 */
function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const statusOf = (error: unknown): number | null =>
  error instanceof ApiFetchError ? error.status : null;

const qs = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return sp.toString();
};

/**
 * The parsed practitioner row, narrowed to the booking-page facts.
 *
 * `services`/`locations` are OPTIONAL on the contract schema because not every
 * code path loads them — `for-service` loads locations only. Absent maps to
 * `null` ("not loaded"), never to `[]` ("performs nothing"). That distinction
 * is the whole reason these fields are nullable in the port.
 */
function toTeamMember(row: PractitionerWithRelationsResponse): TeamMember {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    isActive: row.isActive,
    acceptsBookings: row.acceptsBookings,
    serviceIds: row.services ? row.services.map((s) => s.serviceId) : null,
    locationIds: row.locations ? row.locations.map((l) => l.locationId) : null,
  };
}

/** Case-insensitive name match, applied client-side where the route has no
 *  search parameter — declared on the input rather than silently dropped. */
const matchesSearch = (m: TeamMember, search: string | undefined): boolean =>
  !search || m.name.toLowerCase().includes(search.trim().toLowerCase());

function blockedFrom(error: unknown, notFound?: { id: string }) {
  const status = statusOf(error);
  if (status === 404 && notFound) {
    return {
      status: 'blocked' as const,
      reason: {
        kind: 'not_found' as const,
        what: 'service' as const,
        id: notFound.id,
      },
    };
  }
  return {
    status: 'blocked' as const,
    reason: isServerFault(error)
      ? { kind: 'server_error' as const, message: messageOf(error) }
      : { kind: 'other' as const, message: messageOf(error) },
  };
}

/**
 * Practitioners port — see
 * `packages/contracts/src/ports/practitioners.port.ts` for why a paginated
 * roster must distinguish "that is the team" from "those are the first fifty",
 * and why an unloaded relation may never be reported as an empty one.
 *
 * Every read is PARSED against its contract schema rather than asserted, so a
 * projection that drifts fails here instead of silently yielding `undefined`
 * fields that read as "this person does nothing".
 */
export function createPractitionersPort(
  deps: PractitionersPortDeps
): PractitionersPort {
  const { apiFetch } = deps;

  return {
    async listPractitioners(
      input: ListPractitionersInput
    ): Promise<PractitionerRosterResult> {
      const limit = input.limit ?? 50;
      const offset = input.offset ?? 0;

      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_input',
            message: 'limit must be a whole number between 1 and 100.',
          },
        };
      }
      if (!Number.isInteger(offset) || offset < 0) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_input',
            message: 'offset must be zero or a positive whole number.',
          },
        };
      }

      const scope: RosterScope = {
        kind: 'whole_team',
        search: input.search?.trim() || null,
        includesInactive: input.includeInactive === true,
      };

      let page: ListPractitionersResponseShape;
      try {
        page = await apiFetch(
          `practitioners?${qs({
            limit: String(limit),
            offset: String(offset),
            search: scope.search ?? undefined,
            // The route's DTO coerces the string form; omitting it entirely is
            // what "include inactive" means, so the flag is never sent false.
            isActive: scope.includesInactive ? undefined : 'true',
          })}`,
          { schema: listPractitionersResponseSchema }
        );
      } catch (error) {
        return blockedFrom(error);
      }

      const members = page.items.map(toTeamMember);

      // No total comes back, so a FULL page is indistinguishable from a
      // truncated one. Claiming completeness here is how "you have 50 staff"
      // gets said about a business with 120.
      if (members.length >= limit) {
        return {
          status: 'partially_read',
          scope,
          members,
          more: {
            returned: members.length,
            limit,
            nextOffset: offset + members.length,
          },
        };
      }

      return { status: 'read', scope, members };
    },

    async findForService(
      input: FindPractitionersForServiceInput
    ): Promise<PractitionerRosterResult> {
      const serviceId = input.serviceId?.trim();
      if (!serviceId) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_input',
            message: 'serviceId is required.',
          },
        };
      }

      const scope: RosterScope = {
        kind: 'for_service',
        serviceId,
        search: input.search?.trim() || null,
        // Hardcoded by the route, not chosen here. Echoed so a consumer can
        // see the constraint instead of inferring it from an absence.
        activeOnly: true,
      };

      let rows: PractitionersForServiceResponse;
      try {
        rows = await apiFetch(
          `practitioners/for-service/${encodeURIComponent(serviceId)}`,
          { schema: practitionersForServiceResponseSchema }
        );
      } catch (error) {
        return blockedFrom(error, { id: serviceId });
      }

      const members = rows
        .map(toTeamMember)
        .filter((m) => matchesSearch(m, scope.search ?? undefined));

      // The route returns the whole set with no paging, so this read is always
      // complete for its scope.
      return { status: 'read', scope, members };
    },
  };
}
