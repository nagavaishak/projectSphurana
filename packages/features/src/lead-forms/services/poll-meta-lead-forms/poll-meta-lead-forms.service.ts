import { metaAdsPage } from '@borradh-workspace/database';
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

import { handleMetaAuthError } from '../../../integrations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { ingestMetaLead } from '../../lib/ingest-meta-lead.js';
import {
  type PollMetaLeadFormsInput,
  pollMetaLeadFormsSchema,
} from './poll-meta-lead-forms.schema.js';

const logger = createLogger('PollMetaLeadForms');

/**
 * How far back the cursor is held behind the run's start time when a page
 * yielded no new leads.
 *
 * Without this, a quiet page's cursor never advances and every run re-asks
 * Meta for the whole 90-day window. Without the overlap, a lead created while
 * the run was in flight would fall behind the cursor and never be seen. The
 * `facebook_lead_id` dedupe makes re-reading the overlap free.
 */
const CURSOR_OVERLAP_MS = 30 * 60 * 1000;

export interface PollMetaLeadFormsResult {
  pagesPolled: number;
  pagesSkipped: number;
  formsScanned: number;
  leadsSeen: number;
  leadsCreated: number;
  leadsDuplicate: number;
  /**
   * Recovered (stale) leads for which an opener was actually queued. Excludes
   * duplicates, which queue nothing.
   */
  staleLeadsContacted: number;
  /** Pages whose poll failed outright; their cursor is left untouched. */
  pagesFailed: string[];
}

/**
 * Archived forms still hold their historical leads, so they are worth reading
 * on a recovery run but not on every steady-state tick.
 * Meta reports status as ACTIVE / ARCHIVED / DRAFT / PAUSED (casing varies).
 */
function isReadableForm(status: string | undefined, includeArchived: boolean) {
  if (includeArchived) return true;
  return (status ?? '').toUpperCase() !== 'ARCHIVED';
}

const pollMetaLeadFormsImpl = async (
  db: DbConnection,
  rawInput: PollMetaLeadFormsInput
): Promise<Result<PollMetaLeadFormsResult>> => {
  const parsed = pollMetaLeadFormsSchema.safeParse(rawInput);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid poll input', {
        issues: parsed.error.issues,
      })
    );
  }
  const input = parsed.data;

  const pages = await db.query.metaAdsPage.findMany({
    where: and(
      eq(metaAdsPage.platform, 'facebook'),
      eq(metaAdsPage.isActive, true),
      ...(input.pageId ? [eq(metaAdsPage.pageId, input.pageId)] : [])
    ),
    with: { integration: true },
    limit: input.maxPages,
  });

  const result: PollMetaLeadFormsResult = {
    pagesPolled: 0,
    pagesSkipped: 0,
    formsScanned: 0,
    leadsSeen: 0,
    leadsCreated: 0,
    leadsDuplicate: 0,
    staleLeadsContacted: 0,
    pagesFailed: [],
  };

  const now = Date.now();
  // Counts every staggered opener across the WHOLE run, not per page — the
  // provider rate limit is per sender, not per Meta page.
  let staggerSlot = 0;
  const activationCutoff = new Date(
    now - input.activationWindowMinutes * 60_000
  );

  for (const page of pages) {
    const integration = page.integration;

    if (
      !integration ||
      !integration.isActive ||
      integration.tokenStatus !== 'valid' ||
      (input.organizationId &&
        integration.organizationId !== input.organizationId)
    ) {
      result.pagesSkipped++;
      continue;
    }

    // The poll must not stall behind one broken page: every page is fully
    // isolated, and a failure leaves that page's cursor untouched so the next
    // run retries the same window rather than skipping over it.
    try {
      // Prefer the page token — page-scoped `leads_retrieval` is what survives
      // when Meta stops delivering webhooks. Fall back to the user token,
      // which the webhook path already uses successfully today.
      let accessToken: string | undefined;
      if (page.pageAccessToken) {
        accessToken = decryptCredentials<{ accessToken: string }>(
          page.pageAccessToken
        ).accessToken;
      }
      if (!accessToken) {
        accessToken = decryptCredentials<{ accessToken: string }>(
          integration.encryptedCredentials
        ).accessToken;
      }

      const metaService = new MetaAdsService({
        accessToken,
        adAccountId: page.defaultAdAccountId ?? integration.adAccountId ?? '',
        pageId: page.pageId,
        appSecret: process.env.META_APP_SECRET || undefined,
      });

      // No cursor = never polled. Either a page connected before this job
      // existed, or — the common case from here on — a page that has JUST been
      // connected, whose previous 90 days we import as onboarding.
      const isBackfill = !page.lastLeadPollAt;
      const since =
        page.lastLeadPollAt ??
        new Date(now - input.initialLookbackDays * 24 * 60 * 60 * 1000);

      const forms = await metaService.listAllLeadGenForms();
      let pageLeadsSeen = 0;
      let pageLeadsCreated = 0;

      // `{ [formId]: leadsCount }` as of the previous run. A form whose count
      // has not moved cannot have new leads, so it costs nothing to skip —
      // this is what keeps steady state at ~1 Graph call per page rather than
      // one per form.
      const priorCounts = page.leadFormCounts ?? {};
      const nextCounts: Record<string, number> = {};

      // COLD START. With no stored counts every form is read — ~1,000 Graph
      // calls across all pages on the first tick after deploy — only to be told
      // there is nothing newer than a cursor that was just set to deploy time.
      //
      // Recording the counts without reading is safe *because the cursor is
      // current*: a lead arriving after it MOVES the form's count, so the next
      // tick reads it from this same cursor; a lead arriving before it is
      // already excluded by the cursor. Nothing is skipped that the cursor did
      // not already exclude.
      //
      // Both guards are load-bearing. `includeArchivedForms` means a recovery
      // run, which also starts with empty counts — seeding there would import
      // nothing at all. And a stale cursor means there IS a real window to
      // read, so only a cursor inside the overlap qualifies.
      const seedCountsOnly =
        !isBackfill &&
        !input.includeArchivedForms &&
        Object.keys(priorCounts).length === 0 &&
        since.getTime() >= now - CURSOR_OVERLAP_MS;
      // The cursor advances to the newest lead we actually ingested, not to
      // "now" — a lead Meta had not yet surfaced when we asked must still be
      // reachable on the next run.
      let newestSeen = since;

      // A first-ever poll is a history import, so it reads archived forms even
      // without the flag; the recovery script sets the flag explicitly because
      // it rewinds the cursor and is therefore NOT a null-cursor run.
      const includeArchived = isBackfill || input.includeArchivedForms;

      for (const form of forms) {
        if (!isReadableForm(form.status, includeArchived)) continue;

        const count = form.leadsCount;
        if (typeof count === 'number') nextCounts[form.id] = count;

        // Only skip when Meta actually gave us a number to compare against
        // later; an absent count must still be read, or the form would never
        // be polled again.
        if (seedCountsOnly && typeof count === 'number') continue;

        // Skip only when Meta gives us a count AND it is unchanged. An absent
        // count must fall through to a real read — never treat "unknown" as
        // "nothing new", or a form Meta stops reporting counts for would go
        // silently unpolled, which is the very failure this job exists to fix.
        const unchanged =
          typeof count === 'number' &&
          !isBackfill &&
          !input.includeArchivedForms &&
          priorCounts[form.id] === count;
        if (unchanged) continue;

        result.formsScanned++;

        const leads = await metaService.getFormLeadsSince(form.id, { since });

        for (const leadData of leads) {
          result.leadsSeen++;
          pageLeadsSeen++;

          const createdTime = leadData.createdTime
            ? new Date(leadData.createdTime)
            : null;
          if (
            createdTime &&
            !Number.isNaN(createdTime.getTime()) &&
            createdTime > newestSeen
          ) {
            newestSeen = createdTime;
          }

          const isFresh =
            !!createdTime &&
            !Number.isNaN(createdTime.getTime()) &&
            createdTime >= activationCutoff;

          // A stale lead may still be worth ONE message when the operator asks
          // for it — but never a sequence or a push notification, and never
          // without a stagger.
          const contactStale = !isFresh && input.contactRecovered;
          const contactDelayMs = contactStale
            ? staggerSlot * input.contactStaggerMs
            : 0;

          const outcome = await ingestMetaLead(db, {
            organizationId: integration.organizationId,
            pageId: page.pageId,
            metaPageInternalId: page.id,
            metaService,
            // `activate` stays freshness-only: sequences and notifications are
            // for live leads. Contacting is decided separately.
            activate: isFresh,
            contact: isFresh || contactStale,
            contactDelayMs,
            leadData: {
              id: leadData.id,
              formId: leadData.formId || form.id,
              fieldData: leadData.fieldData,
              createdTime: leadData.createdTime,
              adId: leadData.adId,
              campaignId: leadData.campaignId,
            },
          });

          if (outcome.status === 'created') {
            result.leadsCreated++;
            pageLeadsCreated++;
            if (contactStale) {
              // Counted only once the lead actually exists. A duplicate queues
              // no opener, and this number is printed to the operator as
              // "openers queued" — counting attempts would overstate how many
              // real people were messaged, which is the one number here that
              // must not be optimistic.
              result.staleLeadsContacted++;
              staggerSlot++;
            }
          } else {
            result.leadsDuplicate++;
          }
        }
      }

      // Advance to the newest lead actually ingested, or — if the page was
      // quiet — to just behind the run start, so the window stays bounded.
      const cursor = new Date(
        Math.max(newestSeen.getTime(), now - CURSOR_OVERLAP_MS)
      );

      await db
        .update(metaAdsPage)
        .set({ lastLeadPollAt: cursor, leadFormCounts: nextCounts })
        .where(eq(metaAdsPage.id, page.id));

      result.pagesPolled++;

      if (pageLeadsCreated > 0 && !isBackfill) {
        // ALERT ON THIS. Outside a backfill, every lead the poll creates is a
        // lead Meta never pushed to our webhook for this page — the exact
        // ENG-786 signature, and the signal whose absence let this run
        // unnoticed for months. Stable message: alerts key on it.
        logger.warn(
          `Meta leadgen webhook did not deliver: poll recovered ${pageLeadsCreated} lead(s) for page ${page.pageId}`,
          {
            pageId: page.pageId,
            organizationId: integration.organizationId,
            recoveredCount: pageLeadsCreated,
            leadsSeen: pageLeadsSeen,
          }
        );
      } else if (isBackfill) {
        logger.info(
          `Backfilled page ${page.pageId}: ${forms.length} forms, ${pageLeadsSeen} leads seen, ${pageLeadsCreated} recovered`,
          {
            pageId: page.pageId,
            organizationId: integration.organizationId,
            recoveredCount: pageLeadsCreated,
          }
        );
      }
    } catch (error) {
      result.pagesFailed.push(page.pageId);

      if (error instanceof MetaApiError && error.isAuthError) {
        await handleMetaAuthError(db, error, {
          type: 'meta_ads',
          organizationId: integration.organizationId,
        });
        logger.warn(
          `Meta auth error polling page ${page.pageId}; marked needs_reconnect`,
          {
            pageId: page.pageId,
            organizationId: integration.organizationId,
            metaCode: error.code,
            metaSubcode: error.subcode,
          }
        );
        continue;
      }

      if (error instanceof MetaApiError && error.isExpected) {
        logger.warn(
          `Expected Meta error polling page ${page.pageId} (${error.category}); skipping`,
          {
            pageId: page.pageId,
            organizationId: integration.organizationId,
            metaCode: error.code,
            metaSubcode: error.subcode,
          }
        );
        continue;
      }

      logError('leadForms.pollMetaLeadForms', error, {
        feature: 'lead-forms',
        extra: {
          pageId: page.pageId,
          organizationId: integration.organizationId,
        },
      });
    }
  }

  // PostHog properties must be scalars — the failed-page ids ship as a
  // comma-joined string alongside the count.
  const { pagesFailed, ...counts } = result;
  trackEvent('system', 'leadForms.metaLeadPollCompleted', {
    ...counts,
    pagesFailed: pagesFailed.join(','),
    pagesFailedCount: pagesFailed.length,
  });

  return ok(result);
};

/**
 * Pull-based reconciliation for Meta instant-form leads.
 *
 * Meta can accept our `leadgen` webhook subscription and still withhold
 * delivery for a Page — proven in prod for seven Pages, ~18% of paid form
 * leads lost with zero errors on our side (ENG-786). Lead *reads* are not
 * subject to that gate, so this job walks each connected Page's lead forms and
 * ingests anything the webhook never brought us, deduped on `facebook_lead_id`.
 *
 * The webhook stays the fast path; this is the floor under it.
 */
export const pollMetaLeadForms = (
  db: DbConnection,
  input: PollMetaLeadFormsInput = {}
) =>
  trackedResult(
    'leadForms.pollMetaLeadForms',
    () => pollMetaLeadFormsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        pageId: input.pageId,
      },
    }
  );

export type PollMetaLeadFormsServiceResult = Awaited<
  ReturnType<typeof pollMetaLeadForms>
>;
