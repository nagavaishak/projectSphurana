import {
  campaignRecipient,
  segment,
  suppression,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  buildSegmentWhere,
  buildSuppressionIndex,
  eligibleChannels,
} from '../_shared/index.js';
import {
  type MaterializeRecipientsInput,
  materializeRecipientsSchema,
} from './materialize-recipients.schema.js';

/**
 * Expand a segment into `campaign_recipient` rows — one per (eligible lead ×
 * channel). Idempotent: the insert is `ON CONFLICT DO NOTHING` against the
 * `(campaign_id, lead_id, channel)` unique constraint, so re-running (re-launch,
 * retry, overlapping segments) never produces a duplicate send.
 */
const materializeRecipientsImpl = async (
  db: DbConnection,
  input: MaterializeRecipientsInput
) => {
  const parsed = materializeRecipientsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, campaignId, channels, segmentId, filterJson } =
    parsed.data;

  let filter = filterJson;
  if (segmentId) {
    const seg = await db.query.segment.findFirst({
      where: and(eq(segment.id, segmentId), notDeleted(segment)),
    });
    if (!seg) {
      return err(
        new FeatureError(
          CampaignErrorCodes.SEGMENT_NOT_FOUND,
          'Segment not found'
        )
      );
    }
    filter = seg.filterJson;
  }

  if (!filter) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'No audience filter resolved'
      )
    );
  }

  const leads = await db.query.lead.findMany({
    where: and(...buildSegmentWhere(organizationId, filter)),
    columns: {
      id: true,
      email: true,
      phone: true,
      whatsapp: true,
      consentEmail: true,
      consentSms: true,
    },
  });

  const suppressionRows = await db.query.suppression.findMany({
    where: eq(suppression.organizationId, organizationId),
    columns: { channel: true, contact: true },
  });
  const index = buildSuppressionIndex(suppressionRows);

  const rows: Array<{
    campaignId: string;
    leadId: string;
    channel: 'email' | 'sms' | 'whatsapp';
    status: 'queued';
  }> = [];
  const perChannel: Record<'email' | 'sms' | 'whatsapp', number> = {
    email: 0,
    sms: 0,
    whatsapp: 0,
  };

  for (const l of leads) {
    for (const c of eligibleChannels(l, channels, index)) {
      rows.push({ campaignId, leadId: l.id, channel: c, status: 'queued' });
      perChannel[c]++;
    }
  }

  if (rows.length === 0) {
    return ok({ materialized: 0, eligible: 0, perChannel });
  }

  // ON CONFLICT DO NOTHING → `returning` yields only the newly-inserted rows,
  // so `materialized` excludes recipients that already existed.
  const inserted = await db
    .insert(campaignRecipient)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: campaignRecipient.id });

  return ok({
    materialized: inserted.length,
    eligible: rows.length,
    perChannel,
  });
};

export const materializeRecipients = (
  db: DbConnection,
  input: MaterializeRecipientsInput
) =>
  trackedResult(
    'campaigns.materializeRecipients',
    () => withOrgScope((tx) => materializeRecipientsImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        campaignId: input.campaignId,
      },
    }
  );

export type MaterializeRecipientsResult = Awaited<
  ReturnType<typeof materializeRecipients>
>;
