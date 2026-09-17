import crypto from 'node:crypto';
import {
  lead,
  metaAdsPage,
  withSystemScope,
} from '@borradh-workspace/database';
import {
  MetaAdsService,
  MetaApiError,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import {
  createLogger,
  logError,
  trackEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';

const logger = createLogger('HandleMetaLeadWebhook');
import { handleMetaAuthError } from '../../../integrations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { ingestMetaLead } from '../../lib/ingest-meta-lead.js';
import {
  type HandleMetaLeadWebhookInput,
  handleMetaLeadWebhookInputSchema,
  metaWebhookPayloadSchema,
} from './handle-meta-lead-webhook.schema.js';

interface ProcessedLead {
  leadId: string;
  facebookLeadId: string;
  organizationId: string;
}

/**
 * Verify Meta webhook signature
 */
function verifySignature(
  payload: string,
  signature: string,
  appSecret: string
): boolean {
  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const signatureHash = signature.substring(7); // Remove 'sha256=' prefix
  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(payload)
    .digest('hex');

  // timingSafeEqual requires buffers of the same length
  const signatureBuffer = Buffer.from(signatureHash);
  const expectedBuffer = Buffer.from(expectedHash);

  if (signatureBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

const handleMetaLeadWebhookImpl = async (
  db: DbConnection,
  input: HandleMetaLeadWebhookInput,
  appSecret: string
): Promise<
  Result<{
    processedLeads: ProcessedLead[];
    skippedCount: number;
    pageIds: string[];
    unknownPageIds: string[];
  }>
> => {
  const parsed = handleMetaLeadWebhookInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid webhook input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Verify signature
  if (!verifySignature(parsed.data.payload, parsed.data.signature, appSecret)) {
    return err(
      new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid webhook signature')
    );
  }

  // Parse webhook payload
  let webhookData: ReturnType<typeof metaWebhookPayloadSchema.parse>;
  try {
    const rawData = JSON.parse(parsed.data.payload);
    const payloadParsed = metaWebhookPayloadSchema.safeParse(rawData);
    if (!payloadParsed.success) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Invalid webhook payload format',
          {
            issues: payloadParsed.error.issues,
          }
        )
      );
    }
    webhookData = payloadParsed.data;
  } catch {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid JSON payload')
    );
  }

  const processedLeads: ProcessedLead[] = [];
  let skippedCount = 0;
  // Every page id Meta called us about this run, and the subset we had no
  // integration for. Both are reported on the tracked event so "did Meta call
  // us for page X this week?" is answerable from PostHog rather than only from
  // BetterStack log search (ENG-786).
  const seenPageIds = new Set<string>();
  const unknownPageIds = new Set<string>();

  // Capability-scoped dead-token tracking: we ALWAYS attempt the lead fetch
  // (even if the integration is flagged needs_reconnect — the messaging token
  // path being dead doesn't imply lead fetching is). Only after the lead-fetch
  // capability itself fails with an auth error for a page do we skip that
  // page's remaining leads for THIS run.
  const deadPageIds = new Set<string>();

  // Process each leadgen entry
  for (const entry of webhookData.entry) {
    const pageId = entry.id;
    seenPageIds.add(pageId);

    for (const change of entry.changes) {
      if (change.field !== 'leadgen') continue;

      const { leadgen_id, form_id } = change.value;

      if (deadPageIds.has(pageId)) {
        logger.warn(
          `Skipping lead ${leadgen_id}: page ${pageId} token already failed auth this run`
        );
        skippedCount++;
        continue;
      }

      // Set once the page's integration is resolved so the catch block can
      // mark the right org as needs_reconnect on an auth error.
      let organizationId: string | null = null;

      try {
        // Find the page and its integration
        const page = await db.query.metaAdsPage.findFirst({
          where: eq(metaAdsPage.pageId, pageId),
          with: {
            integration: true,
          },
        });

        if (!page || !page.integration) {
          // Meta delivered a leadgen event for a page we don't have connected.
          // Silently `continue`ing here is how ENG-786 stayed invisible for
          // weeks — log it so "did Meta call us for page X?" is answerable.
          logger.warn(
            `Leadgen webhook for unconnected page ${pageId}; skipping lead ${leadgen_id}`,
            { pageId, leadgenId: leadgen_id, formId: form_id }
          );
          unknownPageIds.add(pageId);
          skippedCount++;
          continue;
        }

        const integration = page.integration;
        organizationId = integration.organizationId;

        // Cheap dedupe BEFORE the Graph call. Meta retries this webhook
        // aggressively, and the poll can have ingested the same lead first —
        // neither is worth an API round-trip. `ingestMetaLead` repeats the
        // check as the race-safe backstop.
        const existingLead = await db.query.lead.findFirst({
          where: and(
            eq(lead.facebookLeadId, leadgen_id),
            eq(lead.organizationId, integration.organizationId),
            notDeleted(lead)
          ),
        });

        if (existingLead) {
          skippedCount++;
          continue; // Lead already processed
        }

        // Decrypt the access token from encrypted credentials
        const credentials = decryptCredentials<{ accessToken: string }>(
          integration.encryptedCredentials
        );

        // Ensure we have an ad account ID configured
        if (!integration.adAccountId) {
          logError(
            'leadForms.handleMetaLeadWebhook',
            new Error('Meta integration missing ad account ID'),
            {
              feature: 'lead-forms',
              extra: { leadgenId: leadgen_id, pageId },
            }
          );
          skippedCount++;
          continue;
        }

        // Fetch full lead data from Meta
        const metaService = new MetaAdsService({
          accessToken: credentials.accessToken,
          adAccountId: integration.adAccountId,
          pageId: page.pageId,
          appSecret: process.env.META_APP_SECRET || undefined,
        });
        // Throws on failure (MetaApiError for classified Meta errors) — the
        // catch below triages: auth error → mark needs_reconnect + dead-page
        // skip for this run; expected (e.g. deleted lead 100/33) → warn +
        // skip; unknown → logError.
        const leadData = await metaService.getLeadDetails(leadgen_id);

        const outcome = await ingestMetaLead(db, {
          organizationId: integration.organizationId,
          pageId,
          metaPageInternalId: page.id,
          metaService,
          // Webhook delivery means the submission just happened, so Claire's
          // opener and any matched sequence fire immediately.
          activate: true,
          leadData: {
            id: leadgen_id,
            formId: leadData.formId || form_id,
            fieldData: leadData.fieldData,
            createdTime: leadData.createdTime,
            adId: leadData.adId,
            campaignId: leadData.campaignId,
          },
        });

        if (outcome.status === 'duplicate') {
          skippedCount++;
          continue; // Lead already processed (webhook retry, or the poll won)
        }

        const leadId = outcome.leadId;

        processedLeads.push({
          leadId,
          facebookLeadId: leadgen_id,
          organizationId: integration.organizationId,
        });
      } catch (error) {
        skippedCount++;

        if (error instanceof MetaApiError && error.isAuthError) {
          // The lead-fetch capability itself failed auth for this page. Mark
          // the integration needs_reconnect and stop hammering the dead token
          // for the remaining leads of this page THIS run only — the next
          // webhook still attempts the fetch (the token may have been fixed,
          // or only some capabilities may be affected).
          if (organizationId) {
            await handleMetaAuthError(db, error, {
              type: 'meta_ads',
              organizationId,
            });
          }
          deadPageIds.add(pageId);
          logger.warn(
            `Meta auth error fetching lead ${leadgen_id} for page ${pageId}; skipping remaining leads for this page this run`,
            {
              leadgenId: leadgen_id,
              pageId,
              formId: form_id,
              organizationId,
              metaCode: error.code,
              metaSubcode: error.subcode,
            }
          );
          continue;
        }

        if (error instanceof MetaApiError && error.isExpected) {
          // e.g. 100/33 — lead deleted on Meta or no longer permissioned.
          // Expected, recipient/user-side condition: warn, no Sentry.
          logger.warn(
            `Expected Meta error processing lead ${leadgen_id} (${error.category}); skipping`,
            {
              leadgenId: leadgen_id,
              pageId,
              formId: form_id,
              metaCategory: error.category,
              metaCode: error.code,
              metaSubcode: error.subcode,
            }
          );
          continue;
        }

        // Genuinely unclassified failure — this is the only path that pages.
        logError('leadForms.handleMetaLeadWebhook', error, {
          feature: 'lead-forms',
          extra: { leadgenId: leadgen_id, pageId, formId: form_id },
        });
      }
    }
  }

  // trackedResult's properties are fixed at call time, so the per-run counts
  // that actually answer "is Meta delivering for this page?" are emitted here.
  // PostHog properties must be scalars, so the id sets ship as comma-joined
  // strings — still greppable/filterable, which is the point.
  trackEvent('system', 'leadForms.metaLeadWebhookProcessed', {
    processedCount: processedLeads.length,
    skippedCount,
    pageIds: [...seenPageIds].join(','),
    unknownPageIds: [...unknownPageIds].join(','),
    unknownPageCount: unknownPageIds.size,
    organizationIds: [
      ...new Set(processedLeads.map((l) => l.organizationId)),
    ].join(','),
  });

  return ok({
    processedLeads,
    skippedCount,
    pageIds: [...seenPageIds],
    unknownPageIds: [...unknownPageIds],
  });
};

export const handleMetaLeadWebhook = (
  db: DbConnection,
  input: HandleMetaLeadWebhookInput,
  appSecret: string
) =>
  trackedResult(
    'leadForms.handleMetaLeadWebhook',
    () =>
      withSystemScope(
        (conn) => handleMetaLeadWebhookImpl(conn, input, appSecret),
        { db }
      ),
    { properties: { hasSignature: !!input.signature } }
  );

export type HandleMetaLeadWebhookResult = Awaited<
  ReturnType<typeof handleMetaLeadWebhook>
>;

/**
 * Verify webhook challenge (for webhook registration)
 * Meta sends a verification request when setting up webhooks
 */
export const verifyLeadWebhookChallenge = (
  mode: string,
  token: string,
  challenge: string,
  verifyToken: string
): string | null => {
  if (mode !== 'subscribe') return null;
  const aBuf = Buffer.from(token);
  const bBuf = Buffer.from(verifyToken);
  if (aBuf.length !== bBuf.length) return null;
  if (!crypto.timingSafeEqual(aBuf, bBuf)) return null;
  return challenge;
};
