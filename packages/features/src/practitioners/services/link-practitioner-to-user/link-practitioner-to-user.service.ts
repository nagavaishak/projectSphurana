import { practitioner, withOrgScope } from '@borradh-workspace/database';
import type { Practitioner } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNull } from 'drizzle-orm';
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
  type LinkPractitionerToUserInput,
  linkPractitionerToUserSchema,
} from './link-practitioner-to-user.schema.js';

const linkPractitionerToUserImpl = async (
  db: DbConnection,
  input: LinkPractitionerToUserInput
): Promise<Result<Practitioner>> => {
  const parsed = linkPractitionerToUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, organizationId, email } = parsed.data;

  // Find practitioner by email in this org
  const existing = await db.query.practitioner.findFirst({
    where: and(
      eq(practitioner.email, email.toLowerCase()),
      eq(practitioner.organizationId, organizationId),
      notDeleted(practitioner)
    ),
  });

  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'No practitioner found with this email in this organization'
      )
    );
  }

  // Idempotent: if already linked to same user, return ok
  if (existing.userId === userId) {
    return ok(existing);
  }

  // If linked to a different user, conflict
  if (existing.userId && existing.userId !== userId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This practitioner is already linked to another user'
      )
    );
  }

  try {
    const [updated] = await db
      .update(practitioner)
      // Linking IS acceptance: this person now has an account in this org, so
      // the "invited, hasn't accepted" hold on their bookability is released
      // (ENG-794). Set unconditionally — it is already false for anyone who
      // was never invited through the team-member flow.
      .set({ userId, invitationPending: false })
      .where(
        and(
          eq(practitioner.id, existing.id),
          isNull(practitioner.userId),
          notDeleted(practitioner)
        )
      )
      .returning();

    if (!updated) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Practitioner was linked to another user concurrently'
        )
      );
    }

    return ok(updated);
  } catch (error) {
    logError('practitioners.linkPractitionerToUser', error, {
      feature: 'practitioners',
      extra: { userId, organizationId, email },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to link practitioner to user'
      )
    );
  }
};

export const linkPractitionerToUser = (
  db: DbConnection,
  input: LinkPractitionerToUserInput
) =>
  trackedResult(
    'practitioners.linkPractitionerToUser',
    () => withOrgScope((tx) => linkPractitionerToUserImpl(tx, input), { db }),
    {
      properties: {
        userId: input.userId,
        organizationId: input.organizationId,
        email: input.email,
      },
    }
  );

export type LinkPractitionerToUserResult = Awaited<
  ReturnType<typeof linkPractitionerToUser>
>;
