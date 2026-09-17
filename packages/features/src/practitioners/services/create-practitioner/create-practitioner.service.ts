import {
  isUniqueViolation,
  practitioner,
  withOrgScope,
} from '@borradh-workspace/database';
import type { Practitioner } from '@borradh-workspace/database';
import { type UserColor, userColorValues } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { seedDefaultWeeklyShifts } from '../../../scheduling/utils/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type CreatePractitionerInput,
  createPractitionerSchema,
} from './create-practitioner.schema.js';

/**
 * Pick the next calendar tint color for a new practitioner: the first value
 * in the palette not already taken by an existing practitioner in the org.
 * Once all colors are taken, cycles back from the start (so additional staff
 * get duplicates rather than null) — callers can manually reassign later.
 */
async function pickUnusedColor(
  db: DbConnection,
  organizationId: string
): Promise<UserColor> {
  const rows = await db
    .select({ color: practitioner.color })
    .from(practitioner)
    .where(
      and(
        eq(practitioner.organizationId, organizationId),
        notDeleted(practitioner)
      )
    );
  const taken = new Set(
    rows.map((r) => r.color).filter(Boolean) as UserColor[]
  );
  const free = userColorValues.find((c) => !taken.has(c));
  return free ?? userColorValues[taken.size % userColorValues.length];
}

const createPractitionerImpl = async (
  db: DbConnection,
  input: CreatePractitionerInput
): Promise<Result<Practitioner>> => {
  const parsed = createPractitionerSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Derive the canonical display name from first/last when `name` is absent.
  const { firstName, lastName, name } = parsed.data;
  const derivedName =
    name?.trim() || `${firstName ?? ''} ${lastName ?? ''}`.trim();
  if (!derivedName) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Name (or first and last name) is required'
      )
    );
  }

  const color =
    parsed.data.color ??
    (await pickUnusedColor(db, parsed.data.organizationId));

  try {
    const [result] = await db
      .insert(practitioner)
      .values({ ...parsed.data, name: derivedName, color })
      .returning();

    // Seed a default weekly shift so the new staff member is rostered (and
    // shows on the calendar) immediately. Mirrors the org's business hours —
    // which hold onboarding-scraped opening hours — falling back to 9–5 Mon–Fri.
    await seedDefaultWeeklyShifts(db, {
      organizationId: result.organizationId,
      practitionerId: result.id,
    });

    return ok(result);
  } catch (error) {
    // drizzle wraps the postgres.js error: `error.message` is only
    // "Failed query: insert into …", and the constraint name lives on the
    // `cause` chain. Matching on the wrapper's message never fired, so a
    // duplicate email escaped as INTERNAL_ERROR → 500 "Failed to create
    // practitioner" — which is what made "Add team member" fail with no
    // invitation and no email (ENG-721).
    if (isUniqueViolation(error, 'practitioner_org_email_unique')) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          'A practitioner with this email already exists in this organization'
        )
      );
    }

    logError('practitioners.createPractitioner', error, {
      feature: 'practitioners',
      extra: {
        email: parsed.data.email,
        organizationId: parsed.data.organizationId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to create practitioner'
      )
    );
  }
};

export const createPractitioner = (
  db: DbConnection,
  input: CreatePractitionerInput
) =>
  trackedResult(
    'practitioners.createPractitioner',
    () => withOrgScope((tx) => createPractitionerImpl(tx, input), { db }),
    {
      properties: { email: input.email, organizationId: input.organizationId },
    }
  );

export type CreatePractitionerResult = Awaited<
  ReturnType<typeof createPractitioner>
>;
