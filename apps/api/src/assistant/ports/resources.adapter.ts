import type {
  AllocatableResource,
  CategoryDeleteResult,
  CategoryWriteBlockedReason,
  CategoryWriteResult,
  ReorderResourcesResult,
  RequirementCheck,
  RequirementsBlockedReason,
  ResourceCategoryRecord,
  ResourceDeleteResult,
  ResourceRecord,
  ResourceUnallocatableReason,
  ResourceWeeklyHours,
  ResourceWriteBlockedReason,
  ResourceWriteResult,
  ResourcesPort,
  ServiceResourceRule,
  SetAppointmentResourceResult,
  SetServiceRequirementsResult,
} from '@borradh-workspace/contracts/ports';
import { resourceCategoryKindValues } from '@borradh-workspace/labels';
import { z } from 'zod';
// Imported from the module, not the tool-factory barrel: the barrel reaches
// `tool-context.ts`, which builds these ports, and importing it here would
// close a cycle.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

/**
 * Concrete `ResourcesPort`, built at the composition root.
 *
 * TRANSPORT, as for every other port: this reaches the capability over the
 * authenticated loopback (`apiFetch`) rather than calling feature services with
 * a `db` handle, so org scoping, the AuthGuard and the controller's error
 * mapping all still apply.
 *
 * EVERY RESPONSE IS PARSED, never asserted: `apiFetch(path, { schema })`,
 * never the type-argument form. The schemas below are declared locally because
 * `packages/contracts/src/responses/` has no resource projections yet; when it
 * grows them, these should be deleted in favour of the shared ones. Parsing
 * rather than asserting is what stops a renamed column from silently reading
 * `undefined` — which, for `isActive` or `workingHours`, would mean reporting
 * an unbookable room as ready.
 *
 * THE ONE JUDGEMENT THIS FILE MAKES, and the reason it is here rather than in
 * a tool: whether what was just written can actually hold a booking. The API
 * answers 200 for a deactivated room, for a room whose schedule names no open
 * day, and for a requirement pointing at an empty category. All three are
 * ordinary, deliberate states; none is an error; each leaves a service
 * unbookable. The port's result types have no shape in which those can be
 * reported as success, and this adapter is what does the checking.
 */

// ============================================================================
// WIRE SCHEMAS — parsed, not asserted
// ============================================================================

const openIntervalSchema = z.object({
  from: z.number(),
  to: z.number(),
});

const weeklyHoursSchema = z.record(z.string(), openIntervalSchema);

const categoryRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(resourceCategoryKindValues),
  description: z.string().nullish(),
  isActive: z.boolean(),
});

const categoryListSchema = z.array(categoryRowSchema);

const resourceRowSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  capacity: z.number(),
  workingHours: weeklyHoursSchema.nullish(),
  locationId: z.string().nullish(),
});

const resourceListSchema = z.array(resourceRowSchema);

const requirementsRowSchema = z.object({
  serviceId: z.string(),
  turnaroundMinutes: z.number().nullish(),
  requirements: z.array(
    z.object({
      categoryId: z.string(),
      eligibleResourceIds: z.array(z.string()),
    })
  ),
});

const acknowledgementSchema = z.object({ success: z.boolean() });

/**
 * `PUT /appointments/:id/resources`. Nullable because a RELEASE answers 200
 * with an empty body.
 */
const appointmentResourceWriteSchema = z
  .object({
    resourceId: z.string(),
    resourceName: z.string(),
    /** ISO. The HOLD, turnaround tail included — not the appointment. */
    startDate: z.string(),
    endDate: z.string(),
    allowOverlap: z.boolean(),
  })
  .nullable();

// ============================================================================
// ERROR CLASSIFICATION
// ============================================================================

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

const statusOf = (error: unknown): number | null =>
  error instanceof ApiFetchError ? error.status : null;

/**
 * A 4xx is the API stating a reason — an ordinary outcome an owner can act on.
 * Anything else is the server breaking. Collapsing the two is what made
 * ordinary "no, because…" answers page someone, so only the fault side may
 * reach Sentry.
 */
function isServerFault(error: unknown): boolean {
  const status = statusOf(error);
  return status === null || status < 400 || status >= 500;
}

/**
 * The tail every blocked-reason union shares. Classification is STATUS-first
 * on purpose: `sanitizeApiError` can replace a message wholesale, so a reason
 * derived from message text alone would silently degrade to `other` the day it
 * trips a redaction pattern. Text is only ever used to DISAMBIGUATE two
 * refusals that share a status.
 */
function fallbackReason(
  error: unknown,
  fallback: string
):
  | { kind: 'other'; message: string }
  | { kind: 'server_error'; message: string } {
  const message = messageOf(error, fallback);
  return isServerFault(error)
    ? { kind: 'server_error', message }
    : { kind: 'other', message };
}

function toCategoryWriteReason(
  error: unknown,
  ctx: { categoryId?: string; name?: string }
): CategoryWriteBlockedReason {
  const status = statusOf(error);
  if (status === 409) {
    return { kind: 'duplicate_name', name: ctx.name ?? '' };
  }
  if (status === 404) {
    return { kind: 'category_not_found', categoryId: ctx.categoryId ?? '' };
  }
  if (status === 400) {
    return {
      kind: 'invalid_input',
      message: messageOf(error, 'The category could not be saved'),
    };
  }
  return fallbackReason(error, 'The category could not be saved');
}

/** `Location not found` and `Resource category not found` share a 404. */
function toResourceWriteReason(
  error: unknown,
  ctx: { resourceId?: string; categoryId?: string; locationId?: string }
): ResourceWriteBlockedReason {
  const status = statusOf(error);
  const message = messageOf(error, 'The resource could not be saved');

  if (status === 404) {
    if (/location not found/i.test(message)) {
      return { kind: 'location_not_found', locationId: ctx.locationId ?? '' };
    }
    if (/category not found/i.test(message)) {
      return { kind: 'category_not_found', categoryId: ctx.categoryId ?? '' };
    }
    // An update names a resource; a create cannot 404 on one.
    if (ctx.resourceId) {
      return { kind: 'resource_not_found', resourceId: ctx.resourceId };
    }
  }
  if (status === 400) return { kind: 'invalid_input', message };

  return fallbackReason(error, 'The resource could not be saved');
}

function toRequirementsReason(
  error: unknown,
  serviceId: string
): RequirementsBlockedReason {
  const status = statusOf(error);
  const message = messageOf(error, 'The requirements could not be saved');

  if (status === 404) return { kind: 'service_not_found', serviceId };
  if (status === 400) {
    // The two selection refusals the service raises: a category from another
    // org, or an eligible resource that is not in the category it was listed
    // under. Both mean "the set you sent does not describe this clinic".
    return /do not belong/i.test(message)
      ? { kind: 'invalid_selection', message }
      : { kind: 'invalid_input', message };
  }
  return fallbackReason(error, 'The requirements could not be saved');
}

// ============================================================================
// BOOKABILITY
// ============================================================================

/**
 * The days a resource is open, or `null` for always-open.
 *
 * `null` working hours mean the resource inherits the clinic's own opening
 * hours — ALWAYS AVAILABLE. Reading that as "never" is the trap this whole
 * feature was designed against, so it gets its own return value rather than an
 * empty array it could be confused with.
 */
function opensOn(hours: ResourceWeeklyHours | null): number[] | null {
  if (hours === null) return null;
  return Object.entries(hours)
    .filter(
      ([day, interval]) => /^[0-6]$/.test(day) && interval.to > interval.from
    )
    .map(([day]) => Number(day))
    .sort((a, b) => a - b);
}

/** Narrow to the type that cannot exist for a resource nobody can book. */
function asAllocatable(record: ResourceRecord): AllocatableResource | null {
  if (!record.isActive) return null;

  const days = opensOn(record.workingHours);
  if (days === null) return { ...record, isActive: true, opensOn: null };

  const [first, ...rest] = days;
  if (first === undefined) return null;
  return { ...record, isActive: true, opensOn: [first, ...rest] };
}

/** Only ever called once `asAllocatable` has returned null. */
function unallocatableReason(
  record: ResourceRecord
): ResourceUnallocatableReason {
  return record.isActive ? { kind: 'no_open_days' } : { kind: 'deactivated' };
}

// ============================================================================
// ROW → RECORD
// ============================================================================

function toCategoryRecord(
  row: z.output<typeof categoryRowSchema>
): ResourceCategoryRecord {
  return {
    categoryId: row.id,
    name: row.name,
    kind: row.kind,
    description: row.description ?? null,
    isActive: row.isActive,
  };
}

function toResourceRecord(
  row: z.output<typeof resourceRowSchema>
): ResourceRecord {
  return {
    resourceId: row.id,
    categoryId: row.categoryId,
    name: row.name,
    isActive: row.isActive,
    capacity: row.capacity,
    workingHours: row.workingHours ?? null,
    locationId: row.locationId ?? null,
  };
}

/** Both write endpoints return the post-write row, so no read-back is needed. */
function toWriteResult(record: ResourceRecord): ResourceWriteResult {
  const allocatable = asAllocatable(record);
  return allocatable
    ? { status: 'saved', resource: allocatable }
    : {
        status: 'saved_unallocatable',
        resource: record,
        reason: unallocatableReason(record),
      };
}

export interface ResourcesPortDeps {
  apiFetch: ApiFetchFn;
}

export function createResourcesPort(deps: ResourcesPortDeps): ResourcesPort {
  const { apiFetch } = deps;

  /**
   * Check each applied rule against the resources the clinic actually has.
   *
   * Returns `null` when the check could not run — the caller must then report
   * `applied_unverified` rather than an empty problem list, because with no
   * resource list read, "nothing is wrong" and "I did not look" are the same
   * silence. Same discipline as `partially_read` in `availability.port.ts`.
   */
  async function verify(
    requirements: ServiceResourceRule[]
  ): Promise<RequirementCheck[] | null> {
    let categories: z.output<typeof categoryListSchema>;
    let resources: z.output<typeof resourceListSchema>;
    try {
      // Inactive categories are included so a rule naming one still resolves a
      // NAME; the resource list is active-only, which is what allocatable
      // means.
      [categories, resources] = await Promise.all([
        apiFetch('resources/categories?includeInactive=true', {
          schema: categoryListSchema,
        }),
        apiFetch('resources', { schema: resourceListSchema }),
      ]);
    } catch {
      return null;
    }

    const nameById = new Map(categories.map((c) => [c.id, c.name]));
    const allocatableIdsByCategory = new Map<string, string[]>();
    for (const row of resources) {
      if (!asAllocatable(toResourceRecord(row))) continue;
      const list = allocatableIdsByCategory.get(row.categoryId) ?? [];
      list.push(row.id);
      allocatableIdsByCategory.set(row.categoryId, list);
    }

    return requirements.map((rule): RequirementCheck => {
      const categoryName = nameById.get(rule.categoryId) ?? rule.categoryId;
      const inCategory = allocatableIdsByCategory.get(rule.categoryId) ?? [];
      const named = new Set(rule.eligibleResourceIds);
      // An EMPTY eligibility list means "any resource in this category".
      const usable =
        named.size === 0
          ? inCategory
          : inCategory.filter((id) => named.has(id));

      const [first, ...rest] = usable;
      if (first !== undefined) {
        return {
          kind: 'satisfiable',
          categoryId: rule.categoryId,
          categoryName,
          allocatableResourceIds: [first, ...rest],
        };
      }

      return {
        kind: 'unsatisfiable',
        categoryId: rule.categoryId,
        categoryName,
        reason:
          named.size === 0
            ? { kind: 'category_empty' }
            : {
                kind: 'named_resources_unallocatable',
                resourceIds: rule.eligibleResourceIds,
              },
      };
    });
  }

  return {
    async createCategory(req): Promise<CategoryWriteResult> {
      try {
        const row = await apiFetch('resources/categories', {
          method: 'POST',
          body: {
            name: req.name,
            ...(req.kind === undefined ? {} : { kind: req.kind }),
            ...(req.description === undefined
              ? {}
              : { description: req.description }),
          },
          schema: categoryRowSchema,
        });
        return { status: 'saved', category: toCategoryRecord(row) };
      } catch (error) {
        return {
          status: 'not_saved',
          reason: toCategoryWriteReason(error, { name: req.name }),
        };
      }
    },

    async updateCategory(req): Promise<CategoryWriteResult> {
      const body: Record<string, unknown> = {};
      if (req.name !== undefined) body.name = req.name;
      if (req.kind !== undefined) body.kind = req.kind;
      if (req.description !== undefined) body.description = req.description;
      if (req.isActive !== undefined) body.isActive = req.isActive;

      try {
        const row = await apiFetch(
          `resources/categories/${encodeURIComponent(req.categoryId)}`,
          { method: 'PUT', body, schema: categoryRowSchema }
        );
        return { status: 'saved', category: toCategoryRecord(row) };
      } catch (error) {
        return {
          status: 'not_saved',
          reason: toCategoryWriteReason(error, {
            categoryId: req.categoryId,
            name: req.name,
          }),
        };
      }
    },

    async deleteCategory(categoryId): Promise<CategoryDeleteResult> {
      try {
        await apiFetch(
          `resources/categories/${encodeURIComponent(categoryId)}`,
          { method: 'DELETE', schema: acknowledgementSchema }
        );
        return { status: 'deleted', categoryId };
      } catch (error) {
        const status = statusOf(error);
        if (status === 404) {
          return {
            status: 'not_deleted',
            reason: { kind: 'category_not_found', categoryId },
          };
        }
        if (status === 409) {
          // The server's sentence names the count and the fix ("delete or move
          // the N resources in this category first"); carried verbatim rather
          // than re-derived, so it cannot drift from what the server enforces.
          return {
            status: 'not_deleted',
            reason: {
              kind: 'category_not_empty',
              message: messageOf(error, 'The category still holds resources'),
            },
          };
        }
        return {
          status: 'not_deleted',
          reason: fallbackReason(error, 'The category could not be deleted'),
        };
      }
    },

    async createResource(req): Promise<ResourceWriteResult> {
      const body: Record<string, unknown> = {
        categoryId: req.categoryId,
        name: req.name,
      };
      if (req.description !== undefined) body.description = req.description;
      if (req.capacity !== undefined) body.capacity = req.capacity;
      if (req.workingHours !== undefined) body.workingHours = req.workingHours;
      if (req.locationId !== undefined) body.locationId = req.locationId;

      try {
        const row = await apiFetch('resources', {
          method: 'POST',
          body,
          schema: resourceRowSchema,
        });
        return toWriteResult(toResourceRecord(row));
      } catch (error) {
        return {
          status: 'not_saved',
          reason: toResourceWriteReason(error, {
            categoryId: req.categoryId,
            locationId: req.locationId ?? undefined,
          }),
        };
      }
    },

    async updateResource(req): Promise<ResourceWriteResult> {
      const body: Record<string, unknown> = {};
      if (req.categoryId !== undefined) body.categoryId = req.categoryId;
      if (req.name !== undefined) body.name = req.name;
      if (req.description !== undefined) body.description = req.description;
      if (req.capacity !== undefined) body.capacity = req.capacity;
      if (req.workingHours !== undefined) body.workingHours = req.workingHours;
      if (req.locationId !== undefined) body.locationId = req.locationId;
      if (req.isActive !== undefined) body.isActive = req.isActive;

      try {
        const row = await apiFetch(
          `resources/${encodeURIComponent(req.resourceId)}`,
          { method: 'PUT', body, schema: resourceRowSchema }
        );
        return toWriteResult(toResourceRecord(row));
      } catch (error) {
        return {
          status: 'not_saved',
          reason: toResourceWriteReason(error, {
            resourceId: req.resourceId,
            categoryId: req.categoryId,
            locationId: req.locationId ?? undefined,
          }),
        };
      }
    },

    async deleteResource(resourceId): Promise<ResourceDeleteResult> {
      try {
        await apiFetch(`resources/${encodeURIComponent(resourceId)}`, {
          method: 'DELETE',
          schema: acknowledgementSchema,
        });
        return { status: 'deleted', resourceId };
      } catch (error) {
        const status = statusOf(error);
        if (status === 404) {
          return {
            status: 'not_deleted',
            reason: { kind: 'resource_not_found', resourceId },
          };
        }
        if (status === 409) {
          // Names the upcoming-booking count and points at `isActive: false`
          // as the alternative. Carried verbatim.
          return {
            status: 'not_deleted',
            reason: {
              kind: 'has_upcoming_bookings',
              message: messageOf(error, 'The resource still holds bookings'),
            },
          };
        }
        return {
          status: 'not_deleted',
          reason: fallbackReason(error, 'The resource could not be deleted'),
        };
      }
    },

    async reorderResources(req): Promise<ReorderResourcesResult> {
      const items = req.order.map((entry) => ({
        id: entry.resourceId,
        sortOrder: entry.sortOrder,
      }));

      try {
        await apiFetch('resources/reorder', {
          method: 'PUT',
          body: { items },
          schema: acknowledgementSchema,
        });
        return {
          status: 'reordered',
          resourceIds: items.map((item) => item.id),
        };
      } catch (error) {
        const status = statusOf(error);
        const message = messageOf(error, 'The order could not be saved');
        if (status === 400) {
          return {
            status: 'not_reordered',
            reason: /do not belong/i.test(message)
              ? { kind: 'unknown_resource', message }
              : { kind: 'invalid_input', message },
          };
        }
        return {
          status: 'not_reordered',
          reason: fallbackReason(error, 'The order could not be saved'),
        };
      }
    },

    async setAppointmentResource(req): Promise<SetAppointmentResourceResult> {
      try {
        const body: Record<string, unknown> = {
          categoryId: req.categoryId,
          resourceId: req.resourceId,
        };
        if (req.force === true) body.force = true;

        const written = await apiFetch(
          `appointments/${encodeURIComponent(req.appointmentId)}/resources`,
          { method: 'PUT', body, schema: appointmentResourceWriteSchema }
        );

        // RELEASE answers 200 with an empty body — the service returns
        // `ok(null)` and Nest serialises that as nothing at all. Parsed as
        // `null` rather than asserted, so a future non-empty body cannot be
        // read as a release.
        if (written === null) {
          return { status: 'released', categoryId: req.categoryId };
        }

        return {
          status: 'assigned',
          resourceId: written.resourceId,
          resourceName: written.resourceName,
          heldFrom: written.startDate,
          heldUntil: written.endDate,
          overlapping: written.allowOverlap,
        };
      } catch (error) {
        // 409 is the ordinary outcome of aiming at a busy room, not a fault:
        // it is the one refusal `force` answers, so it must never be flattened
        // into `not_applied` where that affordance disappears.
        if (statusOf(error) === 409) {
          return {
            status: 'taken',
            message: messageOf(error, 'That resource is already booked'),
          };
        }
        return {
          status: 'not_applied',
          reason: fallbackReason(error, 'The resource could not be set'),
        };
      }
    },

    async setServiceRequirements(req): Promise<SetServiceRequirementsResult> {
      const body: Record<string, unknown> = {
        requirements: req.requirements.map((rule) => ({
          categoryId: rule.categoryId,
          eligibleResourceIds: rule.eligibleResourceIds,
        })),
      };
      // `undefined` leaves turnaround untouched; `null` clears it. Sending the
      // key at all is the difference, so it is only added when asked for.
      if (req.turnaroundMinutes !== undefined) {
        body.turnaroundMinutes = req.turnaroundMinutes;
      }

      let written: z.output<typeof requirementsRowSchema>;
      try {
        written = await apiFetch(
          `resources/requirements/${encodeURIComponent(req.serviceId)}`,
          { method: 'PUT', body, schema: requirementsRowSchema }
        );
      } catch (error) {
        return {
          status: 'not_applied',
          reason: toRequirementsReason(error, req.serviceId),
        };
      }

      const applied: ServiceResourceRule[] = written.requirements;
      const turnaroundMinutes = written.turnaroundMinutes ?? null;
      const checks = await verify(applied);

      if (checks === null) {
        return {
          status: 'applied_unverified',
          serviceId: written.serviceId,
          turnaroundMinutes,
          requirements: applied,
          message:
            'The rules were saved, but the resource list could not be read back, so whether this service can still be booked is unknown.',
        };
      }

      return {
        status: 'applied',
        serviceId: written.serviceId,
        turnaroundMinutes,
        checks,
      };
    },
  };
}
