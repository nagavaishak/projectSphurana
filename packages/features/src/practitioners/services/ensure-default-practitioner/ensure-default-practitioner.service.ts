import {
  type Practitioner,
  member,
  organization,
  practitioner,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { createPractitioner } from '../create-practitioner/create-practitioner.service.js';
import {
  type EnsureDefaultPractitionerInput,
  ensureDefaultPractitionerSchema,
} from './ensure-default-practitioner.schema.js';

/**
 * Guarantee that an organization booking on the Borradh calendar has at least
 * one practitioner, so its availability is expressible at all.
 *
 * WHY THIS EXISTS. Availability is derived SOLELY from `shift` rows, which hang
 * off a practitioner. An org with no practitioner therefore has nowhere to
 * record when it works, when it is off, or when it is blocked out — there is no
 * row to write an "I'm not working Thursday" override onto. The booking page
 * used to paper over this with a separate org-business-hours code path
 * (`computeLegacySlots`), and that path was a correctness hole: it could not see
 * shifts, so a day marked as not working was still offered to customers. Rather
 * than maintain a second, weaker notion of availability, every Borradh-booking
 * org gets a practitioner and there is exactly one code path.
 *
 * The practitioner represents the owner — for the overwhelmingly common case of
 * a solo business, that is simply "the person who does the work". They can be
 * renamed, and staff added, from Team afterwards.
 *
 * IDEMPOTENT: returns the existing practitioner and writes nothing if the org
 * already has one. Safe to call on every org create, settings change, and from
 * a backfill.
 */
const ensureDefaultPractitionerImpl = async (
  db: DbConnection,
  input: EnsureDefaultPractitionerInput
): Promise<Result<{ practitioner: Practitioner; created: boolean }>> => {
  const parsed = ensureDefaultPractitionerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  const existing = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.organizationId, organizationId),
      eq(practitioner.isActive, true),
      notDeleted(practitioner)
    ),
    orderBy: [asc(practitioner.createdAt)],
  });
  if (existing) {
    return ok({ practitioner: existing, created: false });
  }

  // The owner is the practitioner. Fall back to any member: an org whose owner
  // row is missing is malformed, but it still needs to be bookable.
  const owner =
    (await db.query.member.findFirst({
      where: and(
        eq(member.organizationId, organizationId),
        eq(member.role, 'owner')
      ),
      orderBy: [asc(member.createdAt)],
      with: { user: true },
    })) ??
    (await db.query.member.findFirst({
      where: eq(member.organizationId, organizationId),
      orderBy: [asc(member.createdAt)],
      with: { user: true },
    }));

  if (!owner?.user?.email) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Organization has no member to create a practitioner from'
      )
    );
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { name: true },
  });

  const created = await createPractitioner(db, {
    organizationId,
    // A user row can carry a blank name; the org name is a better label on a
    // booking page than an empty string.
    name: owner.user.name?.trim() || org?.name?.trim() || owner.user.email,
    email: owner.user.email,
  });
  if (!created.success) {
    return err(
      new FeatureError(created.error.code, created.error.message, {
        organizationId,
      })
    );
  }

  // `userId` is not part of the practitioner wire contract (it is never client
  // supplied), so it is linked here — it is what ties the owner's login to
  // "their" column on the calendar.
  const [linked] = await db
    .update(practitioner)
    .set({ userId: owner.user.id })
    .where(eq(practitioner.id, created.data.id))
    .returning();

  return ok({ practitioner: linked ?? created.data, created: true });
};

export const ensureDefaultPractitioner = (
  db: DbConnection,
  input: EnsureDefaultPractitionerInput
) =>
  trackedResult(
    'practitioners.ensureDefaultPractitioner',
    () => ensureDefaultPractitionerImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type EnsureDefaultPractitionerResult = Awaited<
  ReturnType<typeof ensureDefaultPractitioner>
>;

/**
 * Best-effort variant for callers that must not fail because of this — org
 * creation, a settings save. The org is still usable without a practitioner
 * (it just shows no slots), so a failure here is logged, not propagated.
 */
export async function ensureDefaultPractitionerBestEffort(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const result = await ensureDefaultPractitioner(db, { organizationId });
    if (!result.success) {
      logError(
        'practitioners.ensureDefaultPractitioner',
        new Error(result.error.message),
        { feature: 'practitioners', extra: { organizationId } }
      );
    }
  } catch (error) {
    logError('practitioners.ensureDefaultPractitioner', error, {
      feature: 'practitioners',
      extra: { organizationId },
    });
  }
}
