import {
  type CampaignChannel,
  campaignRecipient,
  lead,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListCampaignRecipientsInput,
  listCampaignRecipientsSchema,
} from './list-campaign-recipients.schema.js';

/** One materialized send (lead × channel) with its outcome. */
export interface CampaignRecipientRow {
  id: string;
  channel: CampaignChannel;
  status: string;
  /** Failure reason set by the send pipeline, when status is `failed`. */
  error: string | null;
  /** The address/number this channel sends to (from the lead). */
  contact: string | null;
  /** Lead display name, best-effort. */
  name: string | null;
  sentAt: Date | null;
}

/**
 * Mirrors `contactForChannel` in `_shared/channel-eligibility` — including the
 * WhatsApp→phone fallback, without which every WhatsApp row would render with a
 * blank contact and a failure nobody can explain.
 */
function contactFor(
  channel: CampaignChannel,
  l: { email: string | null; phone: string | null; whatsapp: string | null }
): string | null {
  if (channel === 'email') return l.email;
  if (channel === 'sms') return l.phone;
  if (channel === 'whatsapp') return l.whatsapp ?? l.phone;
  return null;
}

/**
 * List a campaign's recipients with their per-recipient outcome (status +
 * failure reason + contact). Powers the "Delivery" view so failures are
 * explainable in-product instead of surfacing only as an aggregate count.
 * Org-scoped read.
 */
const listCampaignRecipientsImpl = async (
  db: DbConnection,
  input: ListCampaignRecipientsInput
): Promise<Result<CampaignRecipientRow[]>> => {
  const parsed = listCampaignRecipientsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const recipients = await db.query.campaignRecipient.findMany({
    where: eq(campaignRecipient.campaignId, parsed.data.id),
    columns: {
      id: true,
      channel: true,
      status: true,
      error: true,
      sentAt: true,
      leadId: true,
    },
    orderBy: [asc(campaignRecipient.createdAt)],
  });

  const leadIds = [...new Set(recipients.map((r) => r.leadId))];
  const leads = leadIds.length
    ? await db.query.lead.findMany({
        where: inArray(lead.id, leadIds),
        columns: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          whatsapp: true,
        },
      })
    : [];
  const leadById = new Map(leads.map((l) => [l.id, l]));

  const rows: CampaignRecipientRow[] = recipients.map((r) => {
    const l = leadById.get(r.leadId);
    const name = l
      ? [l.firstName, l.lastName].filter(Boolean).join(' ') || null
      : null;
    return {
      id: r.id,
      channel: r.channel,
      status: r.status,
      error: r.error,
      contact: l ? contactFor(r.channel, l) : null,
      name,
      sentAt: r.sentAt,
    };
  });

  return ok(rows);
};

export const listCampaignRecipients = (
  db: DbConnection,
  input: ListCampaignRecipientsInput
) =>
  trackedResult(
    'campaigns.listCampaignRecipients',
    () => withOrgScope((tx) => listCampaignRecipientsImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListCampaignRecipientsResult = Awaited<
  ReturnType<typeof listCampaignRecipients>
>;
