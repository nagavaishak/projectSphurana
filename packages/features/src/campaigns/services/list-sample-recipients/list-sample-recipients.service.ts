import { lead, suppression, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  buildSegmentWhere,
  buildSuppressionIndex,
  isChannelEligible,
} from '../_shared/index.js';
import {
  type ListSampleRecipientsInput,
  listSampleRecipientsSchema,
} from './list-sample-recipients.schema.js';

/** One preview recipient — the merge fields the composer previews per lead. */
export interface SampleRecipient {
  leadId: string;
  firstName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
}

/**
 * Return up to `limit` leads from the segment that are actually eligible on the
 * given channel (consent + contact + suppression), for the mail-merge preview.
 *
 * Over-fetches a bounded window then filters by eligibility, so the preview
 * still gets a full page of reachable recipients without scanning the whole
 * segment. Empty result ⇒ the composer falls back to a generic sample.
 */
const listSampleRecipientsImpl = async (
  db: DbConnection,
  input: ListSampleRecipientsInput
) => {
  const parsed = listSampleRecipientsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, filterJson, channel, limit } = parsed.data;

  const leads = await db.query.lead.findMany({
    where: and(...buildSegmentWhere(organizationId, filterJson)),
    columns: {
      id: true,
      firstName: true,
      email: true,
      phone: true,
      whatsapp: true,
      consentEmail: true,
      consentSms: true,
    },
    orderBy: [desc(lead.createdAt)],
    // Over-fetch so eligibility filtering still yields a full page.
    limit: limit * 5,
  });

  const suppressionRows = await db.query.suppression.findMany({
    where: eq(suppression.organizationId, organizationId),
    columns: { channel: true, contact: true },
  });
  const index = buildSuppressionIndex(suppressionRows);

  const recipients: SampleRecipient[] = [];
  for (const l of leads) {
    if (!isChannelEligible(l, channel, index)) continue;
    recipients.push({
      leadId: l.id,
      firstName: l.firstName ?? null,
      email: l.email,
      phone: l.phone,
      whatsapp: l.whatsapp,
    });
    if (recipients.length >= limit) break;
  }

  return ok({ recipients });
};

export const listSampleRecipients = (
  db: DbConnection,
  input: ListSampleRecipientsInput
) =>
  trackedResult(
    'campaigns.listSampleRecipients',
    () => withOrgScope((tx) => listSampleRecipientsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        channel: input.channel,
      },
    }
  );

export type ListSampleRecipientsResult = Awaited<
  ReturnType<typeof listSampleRecipients>
>;
