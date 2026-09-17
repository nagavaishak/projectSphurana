import {
  organizationLocation,
  organizationService,
  practitioner,
  withPublicOrgScope,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { trackedResult } from '@borradh-workspace/observability';
import { count, eq } from 'drizzle-orm';
import {
  bookingLocationAddressLines,
  getBookingLocationById,
  isBookingLocationAddressable,
} from '../../../organization-locations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { evaluateCancellationPolicy } from '../../shared/cancellation-policy.js';
import { resolveManageToken } from '../../shared/resolve-manage-token.js';
import {
  type GetManagedAppointmentInput,
  type ManagedAppointmentView,
  getManagedAppointmentSchema,
} from './get-managed-appointment.schema.js';

/**
 * What the patient sees when they click the link in their confirmation email.
 *
 * Read-only, and deliberately thin: name, when, with whom, and what happens if
 * they cancel now. It does NOT leak the lead record, notes, or anything else
 * hanging off the appointment — the token proves "I hold this booking's link",
 * which is not the same as "I am this client".
 */
const getManagedAppointmentImpl = async (
  db: DbConnection,
  input: GetManagedAppointmentInput
): Promise<Result<ManagedAppointmentView>> => {
  const parsed = getManagedAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const resolved = await resolveManageToken(db, parsed.data);
  if (!resolved.success) return resolved;

  const { org, appointment: appt } = resolved.data;

  const details = await withPublicOrgScope(
    org.id,
    async (tx) => {
      const service = appt.serviceId
        ? await tx.query.organizationService.findFirst({
            where: eq(organizationService.id, appt.serviceId),
          })
        : null;

      const prac = appt.practitionerId
        ? await tx.query.practitioner.findFirst({
            where: eq(practitioner.id, appt.practitionerId),
          })
        : null;

      // The branch the appointment is STAMPED with — by id, with no default
      // fallback, because a booking that names no branch must show no address
      // rather than the primary one's.
      const location = await getBookingLocationById(
        tx,
        org.id,
        appt.locationId
      );

      // Only the COUNT, not the rows: it is the single input to
      // `isBookingLocationAddressable` beyond this branch's own slug.
      const [locationCount] = await tx
        .select({ value: count() })
        .from(organizationLocation)
        .where(eq(organizationLocation.organizationId, org.id));

      return { service, prac, location, count: locationCount?.value ?? 0 };
    },
    { db }
  );

  const isActionable = (
    activeAppointmentStatuses as readonly string[]
  ).includes(appt.status);

  return ok({
    appointmentId: appt.id,
    title: appt.title,
    startDate: appt.startDate,
    endDate: appt.endDate,
    status: appt.status,
    isActionable,
    serviceName: details.service?.name ?? null,
    practitionerName: details.prac?.name ?? null,
    serviceId: appt.serviceId ?? null,
    practitionerId: appt.practitionerId ?? null,
    durationMinutes: Math.round(
      (appt.endDate.getTime() - appt.startDate.getTime()) / 60_000
    ),
    location: details.location
      ? {
          id: details.location.id,
          name: details.location.name,
          slug: details.location.slug,
          addressLines: bookingLocationAddressLines(details.location),
        }
      : null,
    canRescheduleOnline:
      !!appt.serviceId &&
      isBookingLocationAddressable(details.location, details.count),
    organization: {
      name: org.name,
      slug: org.slug,
      logo: org.logo ?? null,
      timezone: org.timezone,
    },
    policy: evaluateCancellationPolicy(org, appt.startDate),
  });
};

export const getManagedAppointment = (
  db: DbConnection,
  input: GetManagedAppointmentInput
) =>
  trackedResult(
    'appointments.getManagedAppointment',
    () => getManagedAppointmentImpl(db, input),
    {
      properties: { organizationSlug: input.organizationSlug },
      // A dead/expired link is the expected steady state for old emails, not an
      // incident. Only log the genuinely unexpected.
      internalErrorsOnly: true,
    }
  );

export type GetManagedAppointmentResult = Awaited<
  ReturnType<typeof getManagedAppointment>
>;
