/**
 * Resource-scheduling seed helpers (rooms / equipment).
 *
 * Insert real rows for the resource integration specs so the exclusion
 * constraint, the RLS policies + column grants, and the FK actions are all
 * exercised against genuine data. These build on the shared primitives in
 * ../harness.ts (seedOrganization / seedUser / seedService / seedAppointment)
 * but live here so harness.ts stays domain-agnostic — the same split
 * `seeds/scheduling.ts` uses.
 *
 * Tables touched: `resource_category`, `resource`,
 * `service_resource_requirement`, `service_resource_eligibility`,
 * `appointment_resource`.
 *
 * Every helper inserts DIRECTLY via `db` rather than through a feature service:
 * these specs assert what the DATABASE does, so the service layer must not sit
 * between the test and the constraint under test.
 *
 * Also exports `capturePgError` / `unwrapDriverError`, which every NEGATIVE
 * assertion in the resource specs goes through — see their doc comments for why
 * `rejects.toThrow(/constraint_name/)` is a trap here.
 */
import { randomUUID } from 'node:crypto';
import {
  type WorkingHours,
  appointment,
  appointmentResource,
  db,
  organizationLocation,
  organizationService,
  resource,
  resourceCategory,
  serviceResourceEligibility,
  serviceResourceRequirement,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { eq } from 'drizzle-orm';

/* ------------------------------------------------------------------ */
/* Negative-assertion helpers                                          */
/* ------------------------------------------------------------------ */

/** A postgres.js driver error: SQLSTATE + the PG error fields it carries. */
export interface DriverError extends Error {
  /** SQLSTATE, e.g. '23P01' exclusion_violation, '42501' insufficient_privilege. */
  code?: string;
  constraint_name?: string;
  table_name?: string;
  column_name?: string;
  detail?: string;
}

/**
 * Unwrap a drizzle `DrizzleQueryError` down to the error postgres.js actually
 * raised.
 *
 * ⚠️  THIS IS NOT OPTIONAL PLUMBING. drizzle re-throws every failed query as
 * `DrizzleQueryError`, whose `message` is `"Failed query: <the SQL>\nparams: …"`
 * and which hangs the REAL error off `.cause`. So
 * `expect(p).rejects.toThrow(/resource_no_overlap/)` matches the SQL TEXT, not
 * the constraint — and `rejects.toThrow(/permission denied/)` matches nothing
 * at all, silently turning a "the grant is real" assertion into a "the query
 * failed somehow" assertion. Both would pass for entirely the wrong reason.
 *
 * Walks the `cause` chain and returns the first error carrying a SQLSTATE.
 */
export function unwrapDriverError(error: unknown): DriverError {
  let current: unknown = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!(current instanceof Error)) break;
    const candidate = current as DriverError;
    if (
      typeof candidate.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(candidate.code)
    ) {
      return candidate;
    }
    const next = (current as { cause?: unknown }).cause;
    if (next === undefined || next === null) break;
    current = next;
  }
  return current instanceof Error
    ? (current as DriverError)
    : (new Error(String(error)) as DriverError);
}

/**
 * Run `operation`, require that Postgres REJECTED it, and return the unwrapped
 * driver error so the caller can assert on the SQLSTATE and the constraint
 * name. Throws (failing the test) if the operation succeeded — a negative
 * assertion that silently passes because nothing was rejected is worse than no
 * assertion at all.
 */
export async function capturePgError(
  operation: () => Promise<unknown>
): Promise<DriverError> {
  try {
    await operation();
  } catch (error) {
    return unwrapDriverError(error);
  }
  throw new Error(
    'Expected Postgres to REJECT this operation, but it succeeded.'
  );
}

/* ------------------------------------------------------------------ */
/* Seed helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * Insert a `resource_category` scoped to an org. Returns its id.
 *
 * `name` is unique per org among NON-soft-deleted rows
 * (`resource_category_org_name_unique` is a PARTIAL unique index), so a random
 * suffix keeps repeated seeds from colliding. Pass an explicit `name` when the
 * test is asserting on that index itself.
 */
export async function seedResourceCategory(input: {
  organizationId: string;
  name?: string;
  kind?: (typeof resourceCategory.$inferInsert)['kind'];
  description?: string;
  sortOrder?: number;
  isActive?: boolean;
  deletedAt?: Date | null;
}): Promise<string> {
  const id = `rcat_${randomUUID()}`;
  await db.insert(resourceCategory).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Category ${id}`,
    kind: input.kind ?? 'room',
    description: input.description ?? null,
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
    deletedAt: input.deletedAt ?? null,
  });
  return id;
}

/**
 * Insert a `resource` (a room / a device) scoped to an org + category. Returns
 * its id.
 *
 * `organizationId` and `categoryId` are NOT NULL; `locationId` is nullable and
 * defaults to null ("available at every location"). `capacity` defaults to 1 —
 * the case the `resource_no_overlap` exclusion constraint actually protects.
 * `workingHours` null means "always available" (deliberately unlike Boulevard).
 */
export async function seedResource(input: {
  organizationId: string;
  categoryId: string;
  locationId?: string | null;
  name?: string;
  description?: string | null;
  photo?: string | null;
  capacity?: number;
  specs?: Record<string, string> | null;
  workingHours?: WorkingHours | null;
  sortOrder?: number;
  isActive?: boolean;
  deletedAt?: Date | null;
}): Promise<string> {
  const id = `res_${randomUUID()}`;
  await db.insert(resource).values({
    id,
    organizationId: input.organizationId,
    categoryId: input.categoryId,
    locationId: input.locationId ?? null,
    name: input.name ?? `Resource ${id}`,
    description: input.description ?? null,
    photo: input.photo ?? null,
    capacity: input.capacity ?? 1,
    specs: input.specs ?? null,
    workingHours: input.workingHours ?? null,
    sortOrder: input.sortOrder ?? 0,
    isActive: input.isActive ?? true,
    deletedAt: input.deletedAt ?? null,
  });
  return id;
}

/**
 * Insert a `service_resource_requirement` — "service X needs one resource from
 * category Y". Returns its id.
 *
 * (serviceId, categoryId) is UNIQUE (`service_resource_requirement_unique`), so
 * a given service may require a given category at most once. `quantity`
 * defaults to 1 (v1 always writes 1).
 */
export async function seedRequirement(input: {
  organizationId: string;
  serviceId: string;
  categoryId: string;
  quantity?: number;
}): Promise<string> {
  const id = `rreq_${randomUUID()}`;
  await db.insert(serviceResourceRequirement).values({
    id,
    organizationId: input.organizationId,
    serviceId: input.serviceId,
    categoryId: input.categoryId,
    quantity: input.quantity ?? 1,
  });
  return id;
}

/**
 * Insert a `service_resource_eligibility` — narrows a requirement to a specific
 * resource ("IPL Facial only runs on Laser A"). Returns its id.
 *
 * ZERO rows for a (service, category) pair means EVERY active resource in that
 * category qualifies, so tests asserting the default path must seed NOTHING
 * here rather than seeding every resource.
 */
export async function seedEligibility(input: {
  organizationId: string;
  serviceId: string;
  resourceId: string;
}): Promise<string> {
  const id = `relig_${randomUUID()}`;
  await db.insert(serviceResourceEligibility).values({
    id,
    organizationId: input.organizationId,
    serviceId: input.serviceId,
    resourceId: input.resourceId,
  });
  return id;
}

/**
 * Insert an `appointment_resource` — a resource held for an appointment.
 * Returns its id.
 *
 * Deliberately UNGUARDED: the insert goes straight at the table so a violation
 * of `resource_no_overlap` (or of `appointment_resource_unique`) surfaces as a
 * thrown Postgres error the caller can assert on. Callers testing the happy
 * path should await it normally; callers testing the constraint should wrap it
 * in `expect(...).rejects.toThrow(...)`.
 *
 * `startDate`/`endDate` are timestamptz and REQUIRED — the range is the whole
 * point of the row (it extends past the appointment by the service's turnaround
 * minutes). `allowOverlap` opts the row OUT of the exclusion constraint.
 */
export async function seedAllocation(input: {
  organizationId: string;
  appointmentId: string;
  resourceId: string;
  startDate: Date;
  endDate: Date;
  turnaroundMinutes?: number;
  source?: (typeof appointmentResource.$inferInsert)['source'];
  allowOverlap?: boolean;
}): Promise<string> {
  const id = `ares_${randomUUID()}`;
  await db.insert(appointmentResource).values({
    id,
    organizationId: input.organizationId,
    appointmentId: input.appointmentId,
    resourceId: input.resourceId,
    startDate: input.startDate,
    endDate: input.endDate,
    turnaroundMinutes: input.turnaroundMinutes ?? 0,
    source: input.source ?? 'auto',
    allowOverlap: input.allowOverlap ?? false,
  });
  return id;
}

/* ------------------------------------------------------------------ */
/* Supporting rows the gating / lifecycle / utilisation specs need     */
/* ------------------------------------------------------------------ */

/**
 * Insert an `organization_service` with the fields resource gating actually
 * reads. Returns its id.
 *
 * `harness.seedService` deliberately sets only a name, which is enough for the
 * org-isolation specs but not for these: the gate reads
 * `turnaround_minutes` (the cleanup tail that extends every hold),
 * `appointment_duration` (the public widget's slot length) and `is_active`
 * (the widget refuses an inactive service outright), and utilisation reads
 * `price_cents`. All four are set here so a test never passes because a null
 * quietly disabled the thing under test.
 */
export async function seedResourceService(input: {
  organizationId: string;
  name?: string;
  appointmentDuration?: number;
  priceCents?: number | null;
  turnaroundMinutes?: number | null;
  isActive?: boolean;
}): Promise<string> {
  const id = `svc_${randomUUID()}`;
  await db.insert(organizationService).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Service ${id}`,
    appointmentDuration: input.appointmentDuration ?? 60,
    priceCents: input.priceCents ?? null,
    turnaroundMinutes: input.turnaroundMinutes ?? null,
    isActive: input.isActive ?? true,
  });
  return id;
}

/**
 * Insert an `organization_location`. Returns its id.
 *
 * `addressLine1` / `city` / `country` are NOT NULL with no defaults, so they
 * are filled in here rather than at each call site. `openingHours` null is the
 * documented "inherit organization.businessHours" — utilisation's denominator
 * chain depends on the distinction, so it is passed through verbatim.
 */
export async function seedResourceLocation(input: {
  organizationId: string;
  name?: string;
  openingHours?: WorkingHours | null;
  isPrimary?: boolean;
}): Promise<string> {
  const id = `loc_${randomUUID()}`;
  await db.insert(organizationLocation).values({
    id,
    organizationId: input.organizationId,
    name: input.name ?? `Location ${id}`,
    addressLine1: '1 Test Street',
    city: 'Dublin',
    country: 'ie',
    openingHours: input.openingHours ?? null,
    isPrimary: input.isPrimary ?? false,
  });
  return id;
}

/** Every allocation row an appointment currently holds, resource-id sorted. */
export async function allocationsFor(appointmentId: string): Promise<
  Array<{
    resourceId: string;
    startDate: Date;
    endDate: Date;
    turnaroundMinutes: number;
    source: string;
    allowOverlap: boolean;
  }>
> {
  const rows = await db
    .select({
      resourceId: appointmentResource.resourceId,
      startDate: appointmentResource.startDate,
      endDate: appointmentResource.endDate,
      turnaroundMinutes: appointmentResource.turnaroundMinutes,
      source: appointmentResource.source,
      allowOverlap: appointmentResource.allowOverlap,
    })
    .from(appointmentResource)
    .where(eq(appointmentResource.appointmentId, appointmentId));
  return rows
    .map((row) => ({ ...row, source: row.source as string }))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId));
}

/**
 * THE LIFECYCLE INVARIANT, as a query: every allocation in this org whose
 * appointment is NOT active (cancelled / no-show / soft-deleted / gone).
 *
 * `resolveResourceAvailability` never joins back to `appointment.status`, so a
 * row returned here is a room held hostage forever by an appointment that no
 * longer exists on the calendar. The expected result is ALWAYS zero.
 */
export async function orphanedAllocations(
  organizationId: string
): Promise<
  Array<{ allocationId: string; appointmentId: string; status: string }>
> {
  const rows = await db
    .select({
      allocationId: appointmentResource.id,
      appointmentId: appointmentResource.appointmentId,
      status: appointment.status,
      deletedAt: appointment.deletedAt,
    })
    .from(appointmentResource)
    .leftJoin(
      appointment,
      eq(appointmentResource.appointmentId, appointment.id)
    )
    .where(eq(appointmentResource.organizationId, organizationId));

  return rows
    .filter(
      (row) =>
        row.status === null ||
        row.deletedAt !== null ||
        !(activeAppointmentStatuses as readonly string[]).includes(row.status)
    )
    .map((row) => ({
      allocationId: row.allocationId,
      appointmentId: row.appointmentId,
      status: row.status ?? '<appointment missing>',
    }));
}

/**
 * Paint a resource. Returns nothing — the id the caller already holds is the
 * handle.
 *
 * `resource.color` is a `user_color` pgEnum (the same palette practitioners
 * use, so the rooms calendar reads consistently) and it is NULLABLE: a room
 * with no colour of its own inherits its category's. `seedResource` leaves it
 * null, which is the right default for every test that does not care — this
 * exists for the feed spec, which has to prove the colour survives the join
 * AND that an unpainted room comes back as an explicit `null`.
 */
export async function setResourceColor(
  resourceId: string,
  color: NonNullable<(typeof resource.$inferInsert)['color']>
): Promise<void> {
  await db.update(resource).set({ color }).where(eq(resource.id, resourceId));
}
