/**
 * Meta ads capability port.
 *
 * Second application of the pattern after `videos.port.ts`, and the one with
 * the sharpest measured cost. `meta_ads_confirmUpdateBudget` returned an OK
 * result carrying a `hardBlock` field 6 times in production. Claire had no
 * reason to inspect a field inside a success, so an owner who asked for
 * $20/day was never told the change had been refused — every ad card showed
 * $20/day while the campaign kept running at $15.
 *
 * Two rules do the work here:
 *
 *   1. **A refusal is not a success with a field on it.** `blocked` is a member
 *      of the union, so a caller cannot reach the applied budget without first
 *      branching past the refusal.
 *   2. **Report the budget the SERVER confirmed, never the one that was
 *      requested.** `applied` carries `dailyBudgetCents` read back from the
 *      response. When the API accepts the call but does not echo a value,
 *      that is its own state — not an excuse to repeat the request back as
 *      though it were fact.
 */

export type BudgetBlockedReason =
  /**
   * A learning-phase hard block (`noLiveCampaignChangeDuringLearningPhase`,
   * `noScalingBeforeLearningExits`). This is the case that shipped inside an OK
   * result 6 times.
   */
  | { kind: 'learning_phase'; code: string; message: string }
  | { kind: 'campaign_not_found'; metaCampaignId: string }
  /** The confirmation token was missing, expired, or bound to something else. */
  | { kind: 'not_confirmed'; detail: string }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

export type UpdateBudgetResult =
  /** The server confirmed the new daily budget. This is the only state that may be quoted. */
  | {
      status: 'applied';
      metaCampaignId: string;
      campaignName: string | null;
      dailyBudgetCents: number;
    }
  /**
   * The call succeeded but the response carried no budget, so the applied
   * value is unknown. Distinct from `applied` on purpose: a caller must not
   * quote a figure it never read back. The old code filled this gap with the
   * REQUESTED value and stated it as fact.
   */
  | {
      status: 'accepted_unconfirmed';
      metaCampaignId: string;
      requestedCents: number;
    }
  | { status: 'blocked'; metaCampaignId: string; reason: BudgetBlockedReason };

/* -------------------------------------------------------------------------- */
/*  generateAdCopy                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Generated ad copy. Every field is a plain `string` — NOT `string | null`.
 *
 * That is the whole point. `meta_ads_generateAdCopy` shipped
 * `{ headline: null, primaryText: null, description: null }` with an OK status,
 * and Claire presented the empty result as generated copy. With nullability
 * gone from the success member, "the generator produced nothing" can only be
 * expressed as a different `status`, so a caller cannot relay it as copy.
 *
 * `description` may legitimately be empty: the pre-written-caption path
 * (`matchCaptions`) returns a headline and primary text with no description.
 * `headline` and `primaryText` are never empty in a `generated` result —
 * blank ones are reported as `empty_copy` instead.
 */
export interface AdCopy {
  headline: string;
  primaryText: string;
  /** May be `''` — the matched-caption path has no description. Never null. */
  description: string;
  callToAction: string;
}

export type AdCopyField =
  | 'headline'
  | 'primaryText'
  | 'description'
  | 'callToAction';

/** One D2b content-rule hit, as reported by `validateGeneratedCopy`. */
export interface AdCopyViolation {
  field: string;
  /** `percent_claim` | `outcome_claim` | `banned_phrase` | `pom_brand` | … */
  reason: string;
  /** The text that tripped the rule, when the validator captured it. */
  matched?: string;
}

export type AdCopyBlockedReason =
  /**
   * The call succeeded but carried no usable copy. This is the state the old
   * all-null success was really in, and it now cannot be mistaken for one.
   */
  | { kind: 'empty_copy'; missing: AdCopyField[] }
  /** The video / asset the copy was to be written about does not exist. */
  | { kind: 'media_not_found'; mediaId: string }
  /** The AI provider is over quota or busy (429). Retrying later may work. */
  | { kind: 'rate_limited'; message: string }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

export type GenerateAdCopyResult =
  /** Compliant copy the caller may quote. The only member carrying `AdCopy`. */
  | { status: 'generated'; copy: AdCopy; attempts: number }
  /**
   * Every attempt tripped a hard content rule (percentage discount, quantified
   * outcome claim, banned phrase, POM brand), so no copy was returned.
   *
   * Deliberately NOT a member of `AdCopyBlockedReason`: the owner's request
   * reached a working generator and was refused on its content. That is a
   * different thing from "the call failed", it is actionable in a different
   * way (reword the ask), and collapsing the two loses the only signal that
   * says which.
   */
  | {
      status: 'rejected_by_content_rules';
      attempts: number;
      violations: AdCopyViolation[];
    }
  | { status: 'blocked'; reason: AdCopyBlockedReason };

/* -------------------------------------------------------------------------- */
/*  updateAd                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The fields `PUT /meta-ads/:id` can actually change on an ad.
 *
 * `targetingOverride` is absent on purpose — see `MetaAdsPort.updateAd`.
 */
export type UpdatableAdField =
  | 'name'
  | 'headline'
  | 'primaryText'
  | 'description'
  | 'callToAction'
  | 'destinationUrl';

/** The ad as the server reports it AFTER the write. Never built from a request. */
export interface AdSnapshot {
  adId: string;
  name: string;
  status: string;
  /**
   * Meta's id for this ad, or `null` when it has never been published.
   *
   * THIS is the test for "is this ad on Meta", not `status`. `updateAd`'s
   * service uses exactly this check to decide whether to touch Meta at all
   * (`if (!ad.metaAdId) return ok(result)`), and callers that inferred it from
   * `status !== 'draft'` got the wrong answer for an ad whose publish FAILED:
   * `error` with no `metaAdId` is an ad Meta never accepted, and telling its
   * owner "this is live, saving sends it back for review" is false. Same for
   * `launching`, and for `pending` before the launch call returns.
   */
  metaAdId: string | null;
  headline: string | null;
  primaryText: string | null;
  description: string | null;
  callToAction: string | null;
  destinationUrl: string | null;
  videoId: string | null;
  graphicId: string | null;
}

export type AdUpdateBlockedReason =
  | { kind: 'ad_not_found'; adId: string }
  /** `Cannot update a rejected ad.` — nothing was written. */
  | { kind: 'ad_rejected' }
  /**
   * The ad was built from an existing organic post, so Meta will only accept a
   * name change. Raised AFTER the local row is written.
   */
  | { kind: 'creative_locked_to_existing_post' }
  /**
   * An imported ad with no `metaVideoId` / `metaImageHash`, so no creative can
   * be rebuilt. Raised AFTER the local row is written.
   */
  | { kind: 'creative_media_missing' }
  /** Meta rejected the creative rebuild or the ad update. */
  | { kind: 'meta_sync_failed'; message: string }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

export type UpdateAdResult =
  /**
   * Every requested field came back from the server carrying the requested
   * value. `updated` names them, read from the RESPONSE.
   */
  | {
      status: 'updated';
      adId: string;
      ad: AdSnapshot;
      updated: UpdatableAdField[];
    }
  /**
   * The write was accepted, but at least one requested field did not come back
   * with the value that was asked for.
   *
   * Its own member for the same reason `accepted_unconfirmed` is one on
   * `UpdateBudgetResult`: a partially-applied write reported as a plain success
   * is how "sure, I changed the headline" gets said about an ad that still has
   * the old headline. `unchanged` is never empty here.
   */
  | {
      status: 'partially_updated';
      adId: string;
      ad: AdSnapshot;
      updated: UpdatableAdField[];
      unchanged: UpdatableAdField[];
    }
  /**
   * The local row WAS written and then the Meta sync was refused — the two
   * cases the service raises after its `db.update`, plus a failed creative
   * rebuild. The ad in Borradh has the new copy; the ad running on Meta does
   * not. Reporting this as a flat failure hides the first half; reporting it as
   * success hides the second.
   *
   * No `ad` snapshot: the error response carries no row to read back, so there
   * is nothing here the port is entitled to state as the ad's current shape.
   */
  | {
      status: 'saved_but_not_synced';
      adId: string;
      requested: UpdatableAdField[];
      reason: AdUpdateBlockedReason;
    }
  /** Nothing was written. */
  | { status: 'blocked'; adId: string; reason: AdUpdateBlockedReason };

export interface MetaAdsPort {
  updateBudget(input: {
    metaCampaignId: string;
    dailyBudgetCents: number;
  }): Promise<UpdateBudgetResult>;

  /**
   * Generate compliant ad copy for a video. Retries internally when the D2b
   * validator hard-blocks a generation; the caller sees only the outcome.
   */
  generateAdCopy(input: {
    videoId: string;
    serviceIds?: string[];
    includeOffer?: boolean;
  }): Promise<GenerateAdCopyResult>;

  /**
   * Edit an existing draft ad in place.
   *
   * `targetingOverride` is NOT accepted, and that is the fix rather than an
   * omission. `PUT /meta-ads/:id` persists it to `metaAd.targetingOverride`,
   * and nothing that reaches Meta ever reads it back: `updateAd` sends only
   * `{ name, creative }` to the Marketing API, and `publishAd` resolves an
   * EXISTING ad set (`resolveAdSet`) rather than deriving targeting from the ad
   * row. Delivery targeting lives on the Meta ad set. So the parameter accepted
   * an owner's "target 25-40 within 10km", returned OK, and changed nothing
   * that anyone would ever see. A capability that does not exist should not
   * have an input.
   */
  updateAd(input: {
    adId: string;
    name?: string;
    headline?: string;
    primaryText?: string;
    description?: string;
    callToAction?: string;
    destinationUrl?: string;
  }): Promise<UpdateAdResult>;
}
