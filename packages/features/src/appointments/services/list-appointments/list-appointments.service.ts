import {
  appointment,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, count, desc, eq, gte, lte, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnscoped,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import type { AppointmentWithRelations } from '../../models/index.js';
import { loadEffectiveDeposits } from '../../shared/effective-deposit.js';
import {
  type ListAppointmentsInput,
  listAppointmentsSchema,
} from './list-appointments.schema.js';

export interface ListAppointmentsResponse {
  items: AppointmentWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

const listAppointmentsImpl = async (
  db: DbConnection,
  input: ListAppointmentsInput
): Promise<Result<ListAppointmentsResponse>> => {
  const parsed = listAppointmentsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    locationId,
    leadId,
    assignedToId,
    status,
    startDateFrom,
    startDateTo,
    limit,
    offset,
    scopeToUserId,
  } = parsed.data;

  // Build where conditions
  const conditions: SQL[] = [
    eq(appointment.organizationId, organizationId),
    notDeleted(appointment),
  ];

  // `appointment.location_id` is nullable only until the backfill tightens it
  // (plan §2.1). A row with a NULL branch predates the backfill; it is
  // deliberately NOT matched here, because an appointment with no branch would
  // otherwise appear on every branch's calendar at once.
  if (locationId) {
    conditions.push(atLocationOrUnscoped(appointment.locationId, locationId));
  }

  if (leadId) {
    conditions.push(eq(appointment.leadId, leadId));
  }

  if (assignedToId) {
    conditions.push(eq(appointment.assignedToId, assignedToId));
  }

  if (status) {
    conditions.push(eq(appointment.status, status));
  }

  if (startDateFrom) {
    conditions.push(gte(appointment.startDate, startDateFrom));
  }

  if (startDateTo) {
    conditions.push(lte(appointment.startDate, startDateTo));
  }

  // `view_own` scoping: a member may only see appointments they "own" —
  // either directly assigned to them (assignedToId → user.id, always set) or
  // booked against the practitioner record linked to their user. We resolve
  // the practitioner id (nullable linkage) and OR the two predicates so a
  // member who is also a practitioner sees both buckets.
  if (scopeToUserId) {
    const ownPractitioner = await db.query.practitioner.findFirst({
      where: and(
        eq(practitioner.userId, scopeToUserId),
        eq(practitioner.organizationId, organizationId),
        notDeleted(practitioner)
      ),
      columns: { id: true },
    });

    const ownConditions: SQL[] = [eq(appointment.assignedToId, scopeToUserId)];
    if (ownPractitioner) {
      ownConditions.push(eq(appointment.practitionerId, ownPractitioner.id));
    }

    // `or` over 1+ predicates is always defined here, but narrow for types.
    const ownClause = or(...ownConditions);
    if (ownClause) {
      conditions.push(ownClause);
    }
  }

  const whereClause = and(...conditions);

  // Get items with relations
  const items = await db.query.appointment.findMany({
    where: whereClause,
    with: {
      lead: {
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          metadata: true,
          formData: true,
        },
      },
      assignedTo: {
        columns: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
      service: {
        columns: {
          id: true,
          name: true,
          priceText: true,
          appointmentDuration: true,
        },
      },
    },
    limit,
    offset,
    orderBy: [desc(appointment.startDate)],
  });

  // Get total count via COUNT(*) — an aggregate that stays O(index) instead of
  // materializing every matching row's id into memory just to take .length.
  const [{ value: total }] = await db
    .select({ value: count() })
    .from(appointment)
    .where(whereClause);

  // Attach the effective deposit per appointment in one batched query so the
  // calendar can render a deposit badge / paid amount.
  const deposits = await loadEffectiveDeposits(
    db,
    items.map((item) => item.id)
  );

  return ok({
    items: items.map((item) => ({
      ...item,
      deposit: deposits.get(item.id) ?? null,
    })) as AppointmentWithRelations[],
    total,
    limit,
    offset,
  });
};

export const listAppointments = (
  db: DbConnection,
  input: ListAppointmentsInput
) =>
  trackedResult(
    'appointments.listAppointments',
    () => withOrgScope((tx) => listAppointmentsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListAppointmentsServiceResult = Awaited<
  ReturnType<typeof listAppointments>
>;
