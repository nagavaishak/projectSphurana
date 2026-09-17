import {
  type Practitioner,
  isUniqueViolation,
  organization,
  practitioner,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  type ImportExternalTeamMembersInput,
  importExternalTeamMembersSchema,
} from './import-external-team-members.schema.js';

export interface ImportResult {
  created: Practitioner[];
  linked: Practitioner[];
  skipped: string[];
}

const importExternalTeamMembersImpl = async (
  db: DbConnection,
  input: ImportExternalTeamMembersInput
): Promise<Result<ImportResult>> => {
  const parsed = importExternalTeamMembersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, bookingAccountId, members } = parsed.data;

  // Verify booking account exists and belongs to org
  const account = await db.query.bookingAccount.findFirst({
    where: (t, { and: a, eq: e }) =>
      a(e(t.id, bookingAccountId), e(t.organizationId, organizationId)),
  });

  if (!account) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Booking account not found')
    );
  }

  const selectedMembers = members.filter((m) => m.selected);
  if (selectedMembers.length === 0) {
    return ok({ created: [], linked: [], skipped: [] });
  }

  const created: Practitioner[] = [];
  const linked: Practitioner[] = [];
  const skipped: string[] = [];

  try {
    for (const member of selectedMembers) {
      // Check if practitioner already exists by email
      const existing = await db.query.practitioner.findFirst({
        where: (t, { and: a, eq: e }) =>
          a(
            e(t.organizationId, organizationId),
            e(t.email, member.email.toLowerCase()),
            notDeleted(t)
          ),
      });

      if (existing) {
        // Link existing practitioner to booking account
        const [updated] = await db
          .update(practitioner)
          .set({
            bookingAccountId,
            externalBookingId: member.externalId,
          })
          .where(
            and(eq(practitioner.id, existing.id), notDeleted(practitioner))
          )
          .returning();
        linked.push(updated);
      } else {
        // Create new practitioner
        try {
          const [newPractitioner] = await db
            .insert(practitioner)
            .values({
              organizationId,
              name: member.name,
              email: member.email.toLowerCase(),
              bookingAccountId,
              externalBookingId: member.externalId,
            })
            .returning();
          created.push(newPractitioner);
        } catch (insertError) {
          // Duplicate email race condition - skip. The constraint name is on
          // the drizzle error's `cause` chain, not its message (ENG-721).
          if (isUniqueViolation(insertError, 'practitioner_org_email_unique')) {
            skipped.push(member.email);
          } else {
            throw insertError;
          }
        }
      }
    }

    // Update org: set primaryCalendarType and primaryCalendarAccountId
    await db
      .update(organization)
      .set({
        primaryCalendarType: account.provider,
        primaryCalendarAccountId: bookingAccountId,
      })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );

    return ok({ created, linked, skipped });
  } catch (error) {
    logError('integrations.importExternalTeamMembers', error, {
      feature: 'integrations',
      extra: { organizationId, bookingAccountId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to import team members'
      )
    );
  }
};

export const importExternalTeamMembers = (
  db: DbConnection,
  input: ImportExternalTeamMembersInput
) =>
  trackedResult(
    'integrations.importExternalTeamMembers',
    () => importExternalTeamMembersImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        bookingAccountId: input.bookingAccountId,
        memberCount: input.members.length,
      },
    }
  );

export type ImportExternalTeamMembersResult = Awaited<
  ReturnType<typeof importExternalTeamMembers>
>;
