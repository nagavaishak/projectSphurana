import crypto from 'node:crypto';
import { lead, sql } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';

import { type DbConnection, notDeleted } from '../../../shared/index.js';
import { notifyLeadCreatedSafe } from '../notify-lead-created/index.js';

export interface CreateMetaFormLeadInput {
  organizationId: string;
  /** Meta's leadgen_id — the dedupe key for both the webhook and the poll. */
  facebookLeadId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** Answers plus Meta identifiers (form/page/ad/campaign). */
  formData: Record<string, unknown>;
  /**
   * When the person actually submitted the form. Becomes the lead's
   * `createdAt` so a recovered lead sorts and reports at its real date rather
   * than the moment we happened to ingest it.
   */
  submittedAt: Date;
  /** Sequence to auto-start, or null to create the lead inert. */
  sequence: { id: string } | null;
  /**
   * Outbound side effects. False for leads recovered by the reconciliation
   * poll: a backfill can create hundreds of rows at once and must not fire a
   * push notification per historical enquiry.
   */
  notify: boolean;
  /** Extra provenance merged into `metadata`. */
  metadata?: Record<string, unknown>;
}

export type CreateMetaFormLeadResult =
  | { status: 'created'; leadId: string }
  | { status: 'duplicate' };

/**
 * The single writer for `lead` rows originating from a Meta instant form.
 *
 * Both Meta ingestion paths funnel through here — the `leadgen` webhook (fast
 * path) and the reconciliation poll that exists because Meta silently withholds
 * that webhook for some Pages (ENG-786). Keeping one writer keeps the row shape
 * and the `facebook_lead_id` dedupe identical no matter which path wins the
 * race.
 */
export async function createMetaFormLead(
  db: DbConnection,
  input: CreateMetaFormLeadInput
): Promise<CreateMetaFormLeadResult> {
  // Cheap pre-check: avoids doing any of the work below for the common case
  // (a webhook retry, or the poll re-reading a window it already covered).
  // It is NOT what guarantees uniqueness — see the insert.
  const existing = await db.query.lead.findFirst({
    where: and(
      eq(lead.facebookLeadId, input.facebookLeadId),
      eq(lead.organizationId, input.organizationId),
      notDeleted(lead)
    ),
  });

  if (existing) return { status: 'duplicate' };

  const leadId = crypto.randomUUID();
  const now = new Date();
  const createdAt = Number.isNaN(input.submittedAt.getTime())
    ? now
    : input.submittedAt;

  const inserted = await db
    .insert(lead)
    .values({
      id: leadId,
      organizationId: input.organizationId,
      firstName: input.firstName || 'Unknown',
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      source: 'meta_lead_form',
      status: 'new',
      facebookLeadId: input.facebookLeadId,
      formData: input.formData,
      metadata: {
        webhookProcessedAt: now.toISOString(),
        ...input.metadata,
      },
      // Meta leads have submitted a form, so consent follows the fields given.
      consentEmail: !!input.email,
      consentSms: !!input.phone,
      consentVoice: !!input.phone,
      consentSource: 'meta_form',
      consentedAt: createdAt,
      ...(input.sequence && {
        sequenceId: input.sequence.id,
        sequenceStatus: 'active' as const,
        sequenceStartedAt: now,
        nextActionAt: now, // Trigger immediate execution
      }),
      createdAt,
      updatedAt: now,
    })
    // The real guard. The check above and this insert are not atomic, and the
    // webhook and the 5-minute poll can be processing the same leadgen_id at
    // once — both passing the pre-check before either writes. Without this,
    // that race creates two lead rows and two Claire openers to the same
    // person (the first-touch job id is derived from the lead id, so the usual
    // collapse-on-job-id does not save us).
    //
    // `uq_lead_org_facebook_lead_id` makes the loser of the race a no-op
    // rather than a 500, and `returning` tells us which we were.
    // `where` here is the index predicate, so postgres can match the PARTIAL
    // unique index — it must mirror `uq_lead_org_facebook_lead_id` exactly.
    .onConflictDoNothing({
      target: [lead.organizationId, lead.facebookLeadId],
      where: sql`facebook_lead_id IS NOT NULL AND deleted_at IS NULL`,
    })
    .returning({ id: lead.id });

  // Lost the race: the other writer created the row, and it owns the side
  // effects. Reporting `duplicate` keeps the caller's counters honest.
  if (!inserted.length) return { status: 'duplicate' };

  if (input.notify) {
    notifyLeadCreatedSafe(db, {
      organizationId: input.organizationId,
      leadId,
      firstName: input.firstName || 'Unknown',
      lastName: input.lastName,
      source: 'meta_lead_form',
    });
  }

  return { status: 'created', leadId };
}
