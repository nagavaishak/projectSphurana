import type {
  AdCopy,
  AdCopyBlockedReason,
  AdCopyField,
  AdCopyViolation,
  AdSnapshot,
  AdUpdateBlockedReason,
  BudgetBlockedReason,
  MetaAdsPort,
  UpdatableAdField,
  UpdateAdResult,
} from '@borradh-workspace/contracts/ports';
import { db } from '@borradh-workspace/database';
import { validateGeneratedCopy } from '@borradh-workspace/features/assistant';
// Imported from the module, not the tool-factory barrel — see the note in
// `videos.adapter.ts`: the barrel closes a cycle back through `tool-context`.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

/**
 * Concrete `MetaAdsPort`. Same transport reasoning as `videos.adapter.ts`: the
 * loopback carries the org scope and the role guard (`@RequireRole('admin')`
 * on `PUT /meta-campaigns/:metaCampaignId`), which a direct service call would
 * bypass.
 */

function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

/**
 * Map a typed `FeatureError` code to a budget refusal.
 *
 * The HTTP-status version below is what the loopback forced: a code and a
 * details object were flattened to a sanitised sentence and a status, and the
 * reason had to be reconstructed. Reading `result.error.code` directly is the
 * payoff of the extraction — the reason survives instead of being re-derived.
 */
export function toBudgetBlockedReasonFromCode(
  code: string,
  message: string,
  metaCampaignId: string
): BudgetBlockedReason {
  if (code === 'NOT_FOUND') {
    return { kind: 'campaign_not_found', metaCampaignId };
  }
  if (code === 'INTERNAL_ERROR') {
    return { kind: 'server_error', message };
  }
  return { kind: 'other', message };
}

/* -------------------------------------------------------------------------- */
/*  generateAdCopy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Attempt 1 + up to 2 retries. Copy that still trips a hard content rule after
 * the last attempt yields `rejected_by_content_rules`, never partial copy.
 */
export const MAX_GENERATION_ATTEMPTS = 3;

/**
 * D2b reasons that must reject-and-regenerate rather than surface as a soft
 * warning, per the §8 locked ad-text spec.
 */
const HARD_BLOCK_REASONS: ReadonlySet<string> = new Set([
  'percent_claim',
  'outcome_claim',
  'banned_phrase',
  'pom_brand',
]);

/**
 * The wire shape of `POST /ai-content/generate`.
 *
 * NOTE THE NESTING. `generateContent` returns `{ contentType, content: {...} }`
 * — the copy is one level down. The tool this adapter replaces read
 * `data.headline` at the TOP level, so every field was `undefined` on every
 * call, every proposal collapsed to `{ headline: null, primaryText: null, … }`,
 * and the D2b validator then saw four empty strings and passed them. That is
 * the whole of the "all-null copy with an OK status" defect: not a flaky
 * generator, a mis-read response envelope. Its sibling tools
 * (`generatePostCaption`, `content-tools`) read `result.content.*` correctly.
 */
interface GenerateContentResponse {
  contentType?: string;
  content?: {
    headline?: string;
    primaryText?: string;
    description?: string;
    callToAction?: string;
  };
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function toAdCopyBlockedReason(
  error: unknown,
  videoId: string
): AdCopyBlockedReason {
  const message = messageOf(error, 'Failed to generate ad copy');

  if (error instanceof ApiFetchError) {
    if (error.status === 404) {
      return { kind: 'media_not_found', mediaId: videoId };
    }
    if (error.status === 429) {
      return { kind: 'rate_limited', message };
    }
  }
  return isServerFault(error)
    ? { kind: 'server_error', message }
    : { kind: 'other', message };
}

/**
 * Narrow a response envelope to copy, or name what was missing.
 *
 * `description` is allowed to be blank (the matched-caption path returns none);
 * `headline` and `primaryText` are not, because a caller handed a blank one has
 * nothing to present and would present it anyway.
 */
function toAdCopy(
  response: GenerateContentResponse
): { copy: AdCopy } | { missing: AdCopyField[] } {
  const content = response.content ?? {};
  const headline = content.headline?.trim() ?? '';
  const primaryText = content.primaryText?.trim() ?? '';
  const callToAction = content.callToAction?.trim() ?? '';

  const missing: AdCopyField[] = [];
  if (!headline) missing.push('headline');
  if (!primaryText) missing.push('primaryText');
  if (missing.length > 0) return { missing };

  return {
    copy: {
      headline,
      primaryText,
      description: content.description?.trim() ?? '',
      // The §8 structure puts the ask in `primaryText`; the button defaults to
      // BOOK_NOW. Substituting a default is honest for a fixed enum button in a
      // way that substituting default *copy* would not be.
      callToAction: callToAction || 'BOOK_NOW',
    },
  };
}

/* -------------------------------------------------------------------------- */
/*  updateAd                                                                  */
/* -------------------------------------------------------------------------- */

/** The row `PUT /meta-ads/:id` returns (a `metaAd` record). */
interface UpdateAdResponse {
  id?: string;
  name?: string | null;
  status?: string | null;
  /** Present on the row whenever the ad exists on Meta. */
  metaAdId?: string | null;
  headline?: string | null;
  primaryText?: string | null;
  description?: string | null;
  callToAction?: string | null;
  destinationUrl?: string | null;
  videoId?: string | null;
  graphicId?: string | null;
}

const UPDATABLE_AD_FIELDS: readonly UpdatableAdField[] = [
  'name',
  'headline',
  'primaryText',
  'description',
  'callToAction',
  'destinationUrl',
];

/**
 * Verbatim copies of the three refusals `updateAd` raises AFTER its
 * `db.update(metaAd)` has already landed. Matching them is what separates
 * `saved_but_not_synced` from `blocked`; get the text wrong and a
 * half-applied write is reported as no write at all.
 *
 * `meta-ads.adapter.spec.ts` reads these from the service source and pins them,
 * so a reword fails a test rather than silently degrading the case.
 */
const EXISTING_POST_CREATIVE_MESSAGE =
  'Cannot update creative fields on an ad created from an existing post. Only the ad name can be changed.';
const MISSING_MEDIA_CREATIVE_MESSAGE =
  'Cannot update creative for this ad. Media references are missing.';
const REJECTED_AD_MESSAGE =
  'Cannot update a rejected ad. Please create a new ad.';

export function toAdUpdateBlockedReason(
  error: unknown,
  adId: string
): AdUpdateBlockedReason {
  const message = messageOf(error, 'Failed to update ad');

  if (message === EXISTING_POST_CREATIVE_MESSAGE) {
    return { kind: 'creative_locked_to_existing_post' };
  }
  if (message === MISSING_MEDIA_CREATIVE_MESSAGE) {
    return { kind: 'creative_media_missing' };
  }
  if (message === REJECTED_AD_MESSAGE) {
    return { kind: 'ad_rejected' };
  }
  if (error instanceof ApiFetchError && error.status === 404) {
    return { kind: 'ad_not_found', adId };
  }
  // 422 is `META_SYNC_FAILED` / `META_AD_*_FAILED` — Meta refused the write.
  if (error instanceof ApiFetchError && error.status === 422) {
    return { kind: 'meta_sync_failed', message };
  }
  return isServerFault(error)
    ? { kind: 'server_error', message }
    : { kind: 'other', message };
}

/**
 * Reasons the service can only raise once the local row is already written.
 *
 * `meta_sync_failed` belongs here too: `updateAdImpl`'s catch block explicitly
 * "keeps DB changes (user's intent)" and records a sync error. Everything else
 * — not-found, rejected-ad, an unrecognised refusal, a fault — either precedes
 * the write or cannot be attributed, and an unattributable error must not
 * claim a write happened.
 */
const POST_WRITE_REASON_KINDS: ReadonlySet<AdUpdateBlockedReason['kind']> =
  new Set([
    'creative_locked_to_existing_post',
    'creative_media_missing',
    'meta_sync_failed',
  ]);

function toAdSnapshot(response: UpdateAdResponse, adId: string): AdSnapshot {
  return {
    adId: response.id ?? adId,
    name: response.name ?? '',
    status: response.status ?? 'unknown',
    metaAdId: response.metaAdId ?? null,
    headline: response.headline ?? null,
    primaryText: response.primaryText ?? null,
    description: response.description ?? null,
    callToAction: response.callToAction ?? null,
    destinationUrl: response.destinationUrl ?? null,
    videoId: response.videoId ?? null,
    graphicId: response.graphicId ?? null,
  };
}

/**
 * Paths `MetaAdsPort.updateAd` needs that the SHARED whitelist deliberately
 * omits — `PUT /meta-ads/:id` is not globally reachable, so prompt injection
 * cannot rewrite an arbitrary ad through some unrelated tool.
 *
 * Consequence, and the one wiring wrinkle in this port: `buildAssistantPorts`
 * composes the adapter over the shared `apiFetch`, which would reject that
 * path. Until the composition root threads `buildApiFetch` through, `updateAd`
 * is reached through a port built over the calling tool's own path-extended
 * fetch (see `update-ad.tool.ts`). Same adapter, same union — only the
 * transport's whitelist differs. Exported so the tool and any future
 * composition-root wiring share one definition.
 */
export const META_ADS_WRITE_PATHS: readonly RegExp[] = [
  /^meta-ads\/[a-zA-Z0-9_-]+$/,
];

export interface MetaAdsPortDeps {
  apiFetch: ApiFetchFn;
  /** Org scope for use-case calls that no longer travel through the loopback
   *  (which used to carry it via `@ActiveOrganization()`). */
  organizationId: string;
}

export function createMetaAdsPort(deps: MetaAdsPortDeps): MetaAdsPort {
  return {
    async updateBudget({ metaCampaignId, dailyBudgetCents }) {
      // MIGRATED (step 4). This calls the use case directly — no loopback, no
      // HTTP status codes, no error-message regexes. The typed FeatureError
      // that `updateCampaign` raises is read as a code instead of being
      // flattened to an English sentence and recovered by pattern-matching.
      //
      // The admin gate that the loopback used to carry
      // (`@RequireRole('admin')` on PUT /meta-campaigns/:metaCampaignId) now
      // lives on the tools: `policy: 'admin'`, enforced in the tool factory
      // against `ctx.callerRole`, which is resolved from the same `member` row
      // RoleGuard reads. That transfer is the whole risk of this step, and it
      // is pinned by `tool-factory/tool-policy.spec.ts` and
      // `_integration/tool-meta-ads-budget.int-spec.ts`.
      // Imported LAZILY, and that is load-bearing rather than stylistic.
      //
      // A static import of the meta-campaigns use case drags
      // `packages/integrations` (the Meta SDK, ESM) into the module graph of
      // every spec that so much as builds a tool context — nine suites went
      // red on module load alone. The loopback hop had been providing that
      // build-graph decoupling for free; removing it in step 4 removed the
      // decoupling too, which is a cost the migration recipe does not mention.
      // Deferring the import to call time confines it to callers that actually
      // update a budget.
      const { updateCampaign } = await import(
        '@borradh-workspace/features/meta-campaigns'
      );

      const result = await updateCampaign(db, {
        metaCampaignId,
        organizationId: deps.organizationId,
        dailyBudget: dailyBudgetCents,
      });

      if (!result.success) {
        return {
          status: 'blocked',
          metaCampaignId,
          reason: toBudgetBlockedReasonFromCode(
            result.error.code,
            result.error.message,
            metaCampaignId
          ),
        };
      }

      // `accepted_unconfirmed`, ALWAYS — and that is not a shortcut.
      //
      // `updateCampaign` returns `Result<{ updated: true }>`: it pushes the
      // budget to Meta and reads nothing back, and no local column stores it.
      // So there has never been a server-confirmed figure to quote, and
      // `status: 'applied'` was unreachable through the HTTP path too — the
      // adapter read `response.dailyBudget` from a body that never carried it,
      // so `typeof confirmed !== 'number'` was true on 100% of calls.
      //
      // Reporting the REQUESTED number as fact here is exactly the defect the
      // port was written to prevent (6 production cases of an owner seeing
      // $20/day on a campaign running at $15). Making `applied` reachable needs
      // a read-back from Meta, which is a real capability gap and is recorded
      // as such rather than papered over with the number we just sent.
      return {
        status: 'accepted_unconfirmed',
        metaCampaignId,
        requestedCents: dailyBudgetCents,
      };
    },

    async generateAdCopy({ videoId, serviceIds, includeOffer }) {
      let violations: AdCopyViolation[] = [];

      for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        let response: GenerateContentResponse;
        try {
          response = await deps.apiFetch<GenerateContentResponse>(
            'ai-content/generate',
            {
              method: 'POST',
              body: {
                mediaType: 'video',
                mediaId: videoId,
                contentType: 'ad',
                serviceIds,
                includeOffer: includeOffer === true,
              },
            }
          );
        } catch (error) {
          return {
            status: 'blocked',
            reason: toAdCopyBlockedReason(error, videoId),
          };
        }

        const narrowed = toAdCopy(response);
        if ('missing' in narrowed) {
          // Empty copy is not a retryable content problem — it means the
          // generator (or this adapter's read of it) produced nothing. Say so
          // rather than burning two more attempts on the same empty envelope.
          return {
            status: 'blocked',
            reason: { kind: 'empty_copy', missing: narrowed.missing },
          };
        }

        const { copy } = narrowed;
        const hardBlocked = validateGeneratedCopy({
          headline: copy.headline,
          primaryText: copy.primaryText,
          description: copy.description,
        }).filter((failure) => HARD_BLOCK_REASONS.has(failure.reason));

        if (hardBlocked.length === 0) {
          return { status: 'generated', copy, attempts: attempt };
        }

        violations = hardBlocked;
      }

      return {
        status: 'rejected_by_content_rules',
        attempts: MAX_GENERATION_ATTEMPTS,
        violations,
      };
    },

    async updateAd({ adId, ...requested }) {
      const requestedFields = UPDATABLE_AD_FIELDS.filter(
        (field) => requested[field] !== undefined
      );

      let response: UpdateAdResponse;
      try {
        response = await deps.apiFetch<UpdateAdResponse>(`meta-ads/${adId}`, {
          method: 'PUT',
          body: requested,
        });
      } catch (error) {
        const reason = toAdUpdateBlockedReason(error, adId);
        return POST_WRITE_REASON_KINDS.has(reason.kind)
          ? {
              status: 'saved_but_not_synced',
              adId,
              requested: requestedFields,
              reason,
            }
          : { status: 'blocked', adId, reason };
      }

      const ad = toAdSnapshot(response, adId);

      // Read back, field by field. The old tool built its result card from the
      // REQUEST (`input.headline`) while only the preview came from the
      // response, so a field the server declined to change was still displayed
      // as changed.
      const updated: UpdatableAdField[] = [];
      const unchanged: UpdatableAdField[] = [];
      for (const field of requestedFields) {
        const want = requested[field];
        const got = field === 'name' ? ad.name : ad[field];
        (got === want ? updated : unchanged).push(field);
      }

      const result: UpdateAdResult =
        unchanged.length === 0
          ? { status: 'updated', adId: ad.adId, ad, updated }
          : {
              status: 'partially_updated',
              adId: ad.adId,
              ad,
              updated,
              unchanged,
            };
      return result;
    },
  };
}
