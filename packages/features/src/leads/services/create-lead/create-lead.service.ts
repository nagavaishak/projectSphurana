import {
  isForeignKeyViolation,
  lead,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { notifyLeadCreatedSafe } from '../notify-lead-created/index.js';
import {
  type CreateLeadInput,
  createLeadSchema,
} from './create-lead.schema.js';

/**
 * Internal implementation of create lead
 */
const createLeadImpl = async (
  db: DbConnection,
  input: CreateLeadInput
): Promise<Result<typeof lead.$inferSelect>> => {
  // Validate input
  const parsed = createLeadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Check if lead with same email already exists for this organization (if email provided)
  const emailToCheck = parsed.data.email;
  if (emailToCheck) {
    const existing = await db.query.lead.findFirst({
      where: (lead, { eq, and, isNull }) =>
        and(
          eq(lead.organizationId, parsed.data.organizationId),
          eq(lead.email, emailToCheck),
          isNull(lead.deletedAt)
        ),
    });

    if (existing) {
      return err(
        new FeatureError(
          ErrorCodes.ALREADY_EXISTS,
          `Lead with email ${emailToCheck} already exists in this organization`,
          { email: emailToCheck }
        )
      );
    }
  }

  // Determine if any consent is granted
  const hasAnyConsent =
    parsed.data.consentEmail ||
    parsed.data.consentSms ||
    parsed.data.consentVoice;

  // Create lead.
  //
  // Guarded rather than left to throw: an organization_id that is no longer in
  // the database raises a foreign-key violation, and unguarded that escapes as
  // INTERNAL_ERROR — "An unexpected error occurred" — which says nothing about
  // the one thing the caller could actually act on. The usual cause is a
  // session that outlived its organization.
  let result: typeof lead.$inferSelect | undefined;
  try {
    [result] = await db
      .insert(lead)
      .values({
        organizationId: parsed.data.organizationId,
        primaryLocationId: parsed.data.primaryLocationId ?? null,
        firstName: parsed.data.firstName,
        lastName: parsed.data.lastName,
        email: parsed.data.email,
        phone: parsed.data.phone,
        whatsapp: parsed.data.whatsapp,
        source: parsed.data.source,
        status: parsed.data.status,
        facebookLeadId: parsed.data.facebookLeadId,
        formData: parsed.data.formData,
        assignedToId: parsed.data.assignedToId,
        tags: parsed.data.tags,
        notes: parsed.data.notes,
        metadata: parsed.data.metadata,
        consentEmail: parsed.data.consentEmail,
        consentSms: parsed.data.consentSms,
        consentVoice: parsed.data.consentVoice,
        consentSource: parsed.data.consentSource,
        consentedAt: hasAnyConsent ? new Date() : null,
      })
      .returning();
  } catch (error) {
    if (
      isForeignKeyViolation(error, 'lead_organization_id_organization_id_fk')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.NOT_FOUND,
          'That organization no longer exists. Sign out and back in, or switch organization.'
        )
      );
    }
    throw error;
  }

  // `.returning()` yielding nothing is not something the old destructuring
  // could express — it typed the row as always present and any downstream read
  // would have thrown on undefined. Say it plainly instead.
  if (!result) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create lead')
    );
  }
  notifyLeadCreatedSafe(db, {
    organizationId: result.organizationId,
    leadId: result.id,
    firstName: result.firstName,
    lastName: result.lastName,
    source: result.source,
    assignedToId: result.assignedToId,
  });

  return ok(result);
};

/**
 * Create a new lead
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Lead creation input
 * @returns Result with created lead or error
 *
 * @example
 * ```ts
 * const result = await createLead(db, {
 *   organizationId: 'org_123',
 *   firstName: 'John',
 *   lastName: 'Doe',
 *   email: 'john@example.com',
 *   source: 'facebook',
 * });
 * ```
 */
export const createLead = (db: DbConnection, input: CreateLeadInput) =>
  trackedResult(
    'leads.createLead',
    () => withOrgScope((tx) => createLeadImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for createLead
 */
export type CreateLeadResult = Awaited<ReturnType<typeof createLead>>;
