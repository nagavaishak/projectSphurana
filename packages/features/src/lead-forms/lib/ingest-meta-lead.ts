import type { MetaAdsService } from '@borradh-workspace/integrations';
import { createLogger } from '@borradh-workspace/observability';

import { createMetaFormLead } from '../../leads/index.js';
import type { DbConnection } from '../../shared/index.js';
import { ensureLeadFormSynced } from '../services/ensure-lead-form-synced/index.js';
import { queueLeadFirstTouchSafe } from '../services/handle-meta-lead-webhook/queue-lead-first-touch.js';
import { extractLeadFields } from './extract-lead-fields.js';
import { findSequenceForLead } from './find-sequence-for-lead.js';

const logger = createLogger('IngestMetaLead');

export interface MetaLeadRecord {
  /** Meta's leadgen_id. */
  id: string;
  formId: string;
  fieldData: { name: string; values?: string[] }[] | null | undefined;
  createdTime?: string | null;
  adId?: string | null;
  campaignId?: string | null;
}

export interface IngestMetaLeadInput {
  organizationId: string;
  pageId: string;
  /** Internal metaAdsPage.id, for lead-form linking. */
  metaPageInternalId: string | null;
  leadData: MetaLeadRecord;
  /** Meta API client scoped to this page, for lead-form metadata sync. */
  metaService: Pick<MetaAdsService, 'getLeadGenForm'>;
  /**
   * Full live-lead behaviour: auto-start a matched sequence AND notify the
   * clinic. True on the webhook path (the submission just happened) and for
   * poll results inside the freshness window.
   *
   * Deliberately does NOT cover the opener — see `contact`. A recovered lead
   * may be worth one message without also being dropped into a multi-step
   * sequence or generating a push notification per historical enquiry.
   */
  activate: boolean;
  /**
   * Whether Claire may send her opening message.
   *
   * Defaults to `activate`. A backfill can set this true for stale leads to
   * reach people who enquired and got total silence — `sendLeadFirstTouch`
   * still refuses when a conversation already exists (`already_contacted`),
   * when consent or suppression says no, or when no channel can hold the
   * reply, so this widens WHO is considered, never the safety rules.
   */
  contact?: boolean;
  /** Delay applied to the opener, so a backfill staggers instead of bursting. */
  contactDelayMs?: number;
}

export type IngestMetaLeadOutcome =
  | { status: 'created'; leadId: string }
  | { status: 'duplicate' };

/**
 * Create a `lead` row from a Meta lead, deduped on `facebook_lead_id`.
 *
 * Shared by the leadgen webhook (fast path) and the poll-based reconciliation
 * job (the floor that survives Meta withholding webhook delivery — ENG-786),
 * so both produce identical rows and identical side effects.
 */
export async function ingestMetaLead(
  db: DbConnection,
  input: IngestMetaLeadInput
): Promise<IngestMetaLeadOutcome> {
  const { organizationId, pageId, leadData, activate } = input;
  const leadgenId = leadData.id;

  // A malformed/empty field_data must not crash the caller — log it so the
  // lead is visible (not silently dropped) and still persist the identifiers.
  if (!Array.isArray(leadData.fieldData) || leadData.fieldData.length === 0) {
    logger.warn(
      `Meta lead ${leadgenId} returned no field_data; creating lead with identifiers only`,
      { leadgenId, pageId, formId: leadData.formId }
    );
  }
  const extracted = extractLeadFields(leadData.fieldData);

  const sequenceMatch = activate
    ? await findSequenceForLead(db, organizationId, leadData.adId)
    : null;

  // Stamp the lead with when the person ACTUALLY submitted, not when we
  // ingested. On the webhook path these are seconds apart; on a backfill it is
  // the difference between "797 leads arrived today" and the truth.
  const submittedAt = leadData.createdTime
    ? new Date(leadData.createdTime)
    : new Date();

  const outcome = await createMetaFormLead(db, {
    organizationId,
    facebookLeadId: leadgenId,
    firstName: extracted.firstName,
    lastName: extracted.lastName,
    email: extracted.email,
    phone: extracted.phone,
    formData: {
      ...extracted.formData,
      form_id: leadData.formId,
      page_id: pageId,
      ad_id: leadData.adId ?? undefined,
      campaign_id: leadData.campaignId ?? undefined,
      created_time: leadData.createdTime ?? undefined,
    },
    submittedAt,
    sequence: sequenceMatch,
    // A backfill must not fire a push notification per historical enquiry.
    notify: activate,
    metadata: activate
      ? undefined
      : { recoveredByPoll: true, recoveredAt: new Date().toISOString() },
  });

  if (outcome.status === 'duplicate') return { status: 'duplicate' };
  const leadId = outcome.leadId;

  if (input.contact ?? activate) {
    // Claire opens the conversation rather than waiting to be spoken to.
    // Enqueue only — never send inline: Meta retries the webhook on timeout,
    // and an inline send would make a slow provider call into a duplicate
    // first message. The job id is derived from the lead so a retry (or the
    // poll racing the webhook) collapses onto the same job.
    await queueLeadFirstTouchSafe(
      {
        organizationId,
        leadId,
        facebookLeadId: leadgenId,
      },
      { delayMs: input.contactDelayMs }
    );
  }

  if (sequenceMatch) {
    logger.info(
      `Auto-assigned sequence "${sequenceMatch.name}" to lead ${leadId} (source: ${sequenceMatch.source})`
    );
  }

  // Ensure the Meta lead form exists in our DB and is linked to a service when
  // confident, so the chatbot can tell which service this lead enquired about.
  // Best-effort — never blocks lead processing.
  await ensureLeadFormSynced(db, {
    organizationId,
    metaFormId: leadData.formId,
    metaPageInternalId: input.metaPageInternalId,
    metaService: input.metaService,
  });

  return { status: 'created', leadId };
}
