import { z } from 'zod';

/**
 * Request and response schemas for the Graph endpoints we call.
 *
 * THE ASYMMETRY IS DELIBERATE — read this before adding a schema.
 *
 * REQUESTS are `.strict()`.
 *   A request shape is a fact about OUR code: we decide what to send, so there
 *   is nothing to discover and every field can be declared. Strictness is the
 *   point — it is the detector for "someone added a parameter". Adding a field
 *   to a payload builder without adding it here fails loudly, naming the key.
 *   That is a one-line, reviewable change, and it is the whole reason this file
 *   exists.
 *
 * RESPONSES are PASSTHROUGH (non-strict).
 *   A response shape is a fact about META. We do not control when they add a
 *   field, and a strict response schema would turn every Meta release into a
 *   red build for no benefit. Only a MISSING or CHANGED field we actually read
 *   is a real failure — that is what passthrough gives us.
 *
 * PROVENANCE
 * ----------
 * Request schemas are derived from the payload builders in `meta-ads.service`,
 * `meta-messaging.service`, `whatsapp-cloud.service` and the features-level
 * publish paths. They are exact.
 *
 * Response schemas are derived from the `apiRequest<{…}>` type generics at each
 * call site — types written against real Meta responses and exercised in
 * production daily. That is good evidence but it is NOT a recording: they
 * describe what our code BELIEVES Meta returns, not what it observably does.
 *
 * HOW THAT BELIEF GETS CHECKED
 * ----------------------------
 * This said "RECONCILE BEFORE MERGE" and was merged unreconciled, so the
 * instruction is restated as what actually closes the gap.
 *
 * The primary check is `META_CONTRACT_VALIDATE=true` on a host serving real
 * traffic (see `validate.ts`). It parses every real Graph response against the
 * schema below and logs a structured warning on a mismatch, naming the endpoint
 * and the field. That is strictly better evidence than a one-off recording
 * session: it is continuous, it covers whatever production actually calls
 * rather than whatever the E2E specs happen to drive, and it needs nobody to
 * remember to run it.
 *
 * Recording (`META_CONTRACT_RECORD=1`, see `record.ts`) is still how you author
 * `__golden__/` fixtures and is worth doing — but it is a follow-up, not a
 * precondition, and it must NOT be run against production: the scrubber removes
 * credentials, not message bodies or customer names.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Shared fragments
// ─────────────────────────────────────────────────────────────────────────────

/** Every Graph create returns `{ id }`; `requireId` fails loudly without it. */
export const idResponse = z.object({ id: z.string() }).passthrough();

/** Graph's `{ success: true }` acknowledgement (deletes, subscriptions). */
export const successResponse = z
  .object({ success: z.boolean().optional() })
  .passthrough();

const callToAction = z
  .object({
    type: z.string(),
    value: z
      .object({
        link: z.string().optional(),
        lead_gen_form_id: z.string().optional(),
        app_destination: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Marketing API — campaigns
// ─────────────────────────────────────────────────────────────────────────────

export const createCampaignRequest = z
  .object({
    name: z.string(),
    objective: z.string(),
    status: z.string(),
    special_ad_categories: z.array(z.string()),
    buying_type: z.literal('AUCTION'),
    // Present only WITHOUT campaign budget optimisation…
    is_adset_budget_sharing_enabled: z.boolean().optional(),
    // …and these only WITH it. The CBO/ABO split is asserted in the contract
    // tests, not encoded here — a schema can't express "exactly one of".
    bid_strategy: z.string().optional(),
    daily_budget: z.union([z.string(), z.number()]).optional(),
    lifetime_budget: z.union([z.string(), z.number()]).optional(),
  })
  .strict();

/**
 * `POST /{campaignId}/copies` body.
 *
 * `rename_options` is a JSON **string**, not an object — Graph requires the
 * nested encoding, and sending it as an object silently drops the rename.
 */
export const copyCampaignRequest = z
  .object({
    deep_copy: z.boolean(),
    status_option: z.string(),
    rename_options: z.string(),
  })
  .strict();

export const getCampaignResponse = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.string(),
    effective_status: z.string(),
    objective: z.string(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Marketing API — ad sets
// ─────────────────────────────────────────────────────────────────────────────

export const createAdSetRequest = z
  .object({
    name: z.string(),
    campaign_id: z.string(),
    status: z.string(),
    billing_event: z.string(),
    optimization_goal: z.string(),
    // Targeting is a large, Meta-defined nested object built by
    // `build-meta-targeting`. It has its own dedicated unit tests; re-declaring
    // its internals here would duplicate that contract in two places.
    targeting: z.record(z.string(), z.unknown()),
    bid_strategy: z.string().optional(),
    start_time: z.string().optional(),
    end_time: z.string().optional(),
    daily_budget: z.union([z.string(), z.number()]).optional(),
    bid_amount: z.union([z.string(), z.number()]).optional(),
    promoted_object: z
      .object({
        page_id: z.string().optional(),
        pixel_id: z.string().optional(),
        custom_event_type: z.string().optional(),
        whatsapp_phone_number: z.string().optional(),
      })
      .strict()
      .optional(),
    destination_type: z.string().optional(),
    dsa_beneficiary: z.string().optional(),
    dsa_payor: z.string().optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Marketing API — creatives
// ─────────────────────────────────────────────────────────────────────────────

const videoData = z
  .object({
    video_id: z.string(),
    image_url: z.string().optional(),
    title: z.string().optional(),
    message: z.string().optional(),
    call_to_action: callToAction.optional(),
    page_welcome_message: z.string().optional(),
  })
  .strict();

const linkData = z
  .object({
    link: z.string().optional(),
    message: z.string().optional(),
    name: z.string().optional(),
    /**
     * The line under the headline. Real Meta field, and one WE SEND:
     * `buildAdCreative`'s image branch passes the ad's `description` straight
     * through (`createAdCreativeFromImage` → `linkData.description`).
     *
     * It was missing here, so `.strict()` threw on every image ad that had a
     * description — publishing one under `META_E2E_STUB` died with
     * "Unrecognized key: description" before it reached the fake's responder.
     * The contract said the payload was wrong when the payload was right, which
     * is the one failure mode a contract fake must not have: it means the
     * connected suite has never published an ad with a description, and could
     * not have.
     *
     * (The VIDEO branch is deliberately different — `link_description` is
     * deprecated in Graph v21+ and `createAdCreative` omits it, so `videoData`
     * correctly has no equivalent.)
     */
    description: z.string().optional(),
    image_hash: z.string().optional(),
    picture: z.string().optional(),
    call_to_action: callToAction.optional(),
    page_welcome_message: z.string().optional(),
  })
  .strict();

export const createAdCreativeRequest = z
  .object({
    name: z.string(),
    object_story_spec: z
      .object({
        page_id: z.string(),
        instagram_user_id: z.string().optional(),
        // Exactly one of these is present — video creatives vs image/link
        // creatives. Which one, and how the media URL was resolved (CDN signed
        // vs S3 presigned), is the variant matrix the contract tests cover.
        video_data: videoData.optional(),
        link_data: linkData.optional(),
      })
      .strict(),
    degrees_of_freedom_spec: z.record(z.string(), z.unknown()).optional(),
    asset_feed_spec: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const getCreativeResponse = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    status: z.string().optional(),
    object_story_spec: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Marketing API — ads
// ─────────────────────────────────────────────────────────────────────────────

export const createAdRequest = z
  .object({
    name: z.string(),
    adset_id: z.string(),
    creative: z
      .object({
        creative_id: z.string(),
        degrees_of_freedom_spec: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
    status: z.string(),
  })
  .strict();

export const getAdResponse = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    status: z.string().optional(),
    /**
     * The field `waitForAdActive` polls for — the E2E ads specs block up to
     * 300s on it reaching `ACTIVE`.
     */
    effective_status: z.string().optional(),
    adset_id: z.string().optional(),
    campaign_id: z.string().optional(),
    creative: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

/** Generic `POST /{id}` update — Meta accepts arbitrary mutable fields. */
export const updateNodeRequest = z.record(z.string(), z.unknown());

// ─────────────────────────────────────────────────────────────────────────────
// Marketing API — media upload
// ─────────────────────────────────────────────────────────────────────────────

export const uploadImageResponse = z
  .object({
    images: z.record(
      z.string(),
      z.object({ hash: z.string(), url: z.string().optional() }).passthrough()
    ),
  })
  .passthrough();

export const uploadVideoResponse = z
  .object({
    id: z.string().optional(),
    // Chunked upload: start returns these, finish returns `{ success }`.
    upload_session_id: z.string().optional(),
    video_id: z.string().optional(),
    start_offset: z.string().optional(),
    end_offset: z.string().optional(),
    success: z.boolean().optional(),
  })
  .passthrough();

export const videoStatusResponse = z
  .object({
    status: z
      .object({
        video_status: z.string().optional(),
        processing_progress: z.number().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Messenger
// ─────────────────────────────────────────────────────────────────────────────

export const sendMessageRequest = z
  .object({
    recipient: z.object({ id: z.string() }).strict(),
    messaging_type: z.string().optional(),
    message: z
      .object({
        text: z.string().optional(),
        quick_replies: z.array(z.record(z.string(), z.unknown())).optional(),
        attachment: z.record(z.string(), z.unknown()).optional(),
      })
      .strict()
      .optional(),
    sender_action: z.string().optional(),
    tag: z.string().optional(),
  })
  .strict();

export const sendMessageResponse = z
  .object({
    recipient_id: z.string().optional(),
    message_id: z.string().optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud
// ─────────────────────────────────────────────────────────────────────────────

export const whatsappSendRequest = z
  .object({
    messaging_product: z.literal('whatsapp'),
    recipient_type: z.string().optional(),
    to: z.string(),
    type: z.string(),
    text: z.record(z.string(), z.unknown()).optional(),
    image: z.record(z.string(), z.unknown()).optional(),
    video: z.record(z.string(), z.unknown()).optional(),
    document: z.record(z.string(), z.unknown()).optional(),
    audio: z.record(z.string(), z.unknown()).optional(),
    template: z.record(z.string(), z.unknown()).optional(),
    interactive: z.record(z.string(), z.unknown()).optional(),
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const whatsappSendResponse = z
  .object({
    messaging_product: z.string().optional(),
    contacts: z.array(z.record(z.string(), z.unknown())).optional(),
    messages: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Page reads (the seedMetaAds lookup, page media, insights)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `GET /{pageId}?fields=name,instagram_business_account{…}`.
 *
 * Load-bearing: `seedMetaAds` reads `instagram_business_account.id` to populate
 * `meta_ads_page.linked_instagram_account_id`. A null there permanently
 * disables the Instagram destination and `create-campaign.connected.spec.ts`
 * cannot pass at all — so the fake MUST return an account here.
 */
export const pageLookupResponse = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    followers_count: z.number().optional(),
    instagram_business_account: z
      .object({
        id: z.string(),
        username: z.string().optional(),
        name: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/** A `{ data: [...] }` collection — insights, posts, ads, conversations. */
export const listResponse = z
  .object({
    data: z.array(z.record(z.string(), z.unknown())),
    paging: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Page publishing (features-level, urlencoded bodies)
// ─────────────────────────────────────────────────────────────────────────────

export const publishPhotoRequest = z
  .object({
    url: z.string(),
    access_token: z.string(),
    message: z.string().optional(),
    published: z.string().optional(),
    scheduled_publish_time: z.string().optional(),
    temporary: z.string().optional(),
  })
  .strict();

export const publishFeedRequest = z
  .object({
    access_token: z.string(),
    message: z.string().optional(),
    link: z.string().optional(),
    attached_media: z.string().optional(),
    published: z.string().optional(),
    scheduled_publish_time: z.string().optional(),
  })
  .strict();

export const publishVideoRequest = z
  .object({
    file_url: z.string(),
    access_token: z.string(),
    description: z.string().optional(),
    title: z.string().optional(),
    published: z.string().optional(),
    scheduled_publish_time: z.string().optional(),
  })
  .strict();

export const publishPostResponse = z
  .object({ id: z.string(), post_id: z.string().optional() })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Instagram publishing
// ─────────────────────────────────────────────────────────────────────────────

export const instagramCreateMediaRequest = z
  .object({
    access_token: z.string(),
    image_url: z.string().optional(),
    video_url: z.string().optional(),
    media_type: z.string().optional(),
    caption: z.string().optional(),
    is_carousel_item: z.string().optional(),
    children: z.string().optional(),
  })
  .strict();

export const instagramPublishRequest = z
  .object({
    access_token: z.string(),
    creation_id: z.string(),
  })
  .strict();

export const instagramContainerStatusResponse = z
  .object({
    status_code: z.string().optional(),
    status: z.string().optional(),
    error_message: z.string().optional(),
  })
  .passthrough();

export const instagramProfileResponse = z
  .object({
    id: z.string().optional(),
    name: z.string().optional(),
    username: z.string().optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Lead-gen forms
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /{pageId}/leadgen_forms`.
 *
 * Note the JSON-in-JSON: Meta wants `questions`, `privacy_policy`,
 * `thank_you_page` and `context_card` as STRINGIFIED JSON inside the payload,
 * not as nested objects. Sending real objects is rejected. The nested shapes
 * are asserted in the contract tests, which parse the strings.
 */
export const createLeadGenFormRequest = z
  .object({
    name: z.string(),
    questions: z.string(),
    privacy_policy: z.string(),
    // Messenger auto-start eligibility ("Open Sharing").
    block_display_for_non_targeted_viewer: z.boolean().optional(),
    // THE "Start conversations on Messenger" trigger — Meta's own UI sends this
    // flag on the leadgen_forms edge to auto-create a Messenger thread on submit.
    is_auto_thread_creation_enabled: z.boolean().optional(),
    thank_you_page: z.string().optional(),
    context_card: z.string().optional(),
    locale: z.string().optional(),
    follow_up_action_url: z.string().optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// Page webhook subscription
// ─────────────────────────────────────────────────────────────────────────────

export const subscribeAppRequest = z
  .object({
    subscribed_fields: z.union([z.array(z.string()), z.string()]),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp templates
// ─────────────────────────────────────────────────────────────────────────────

export const createWhatsAppTemplateRequest = z
  .object({
    name: z.string(),
    category: z.string(),
    language: z.string(),
    components: z.array(z.record(z.string(), z.unknown())),
  })
  .strict();

export const whatsAppTemplateResponse = z
  .object({
    id: z.string().optional(),
    status: z.string().optional(),
    category: z.string().optional(),
  })
  .passthrough();

// ─────────────────────────────────────────────────────────────────────────────
// Generic node responses
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `POST /{id}` (update) and `DELETE /{id}`.
 *
 * Meta answers `{ success: true }` for most mutations and `{ id }` for a few.
 * Both are accepted — asserting one would produce noise, not signal.
 */
export const mutationAckResponse = z
  .object({
    success: z.boolean().optional(),
    id: z.string().optional(),
  })
  .passthrough();

/**
 * `POST /{campaignId}/copies`.
 *
 * `copyCampaign` reads `copied_campaign_id` first and falls back to `id`, so
 * either alone is a working answer — but a response carrying NEITHER makes the
 * duplicate a silent no-op, which is what this schema is here to catch.
 */
export const copyCampaignResponse = z
  .object({
    copied_campaign_id: z.string().optional(),
    id: z.string().optional(),
    ad_object_ids: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()
  .refine(
    (r) => Boolean(r.copied_campaign_id ?? r.id),
    'a copy response must carry copied_campaign_id or id'
  );

/**
 * `GET /act_x` — funding source AND the pre-publish account health read.
 *
 * Every field is optional because the two callers ask for different `fields`:
 * `getFundingSource` requests only the funding detail, `getAdAccountHealth`
 * requests the lot. Requiring `account_status` would fail the narrower call for
 * a field it never asked for.
 */
export const fundingSourceResponse = z
  .object({
    id: z.string().optional(),
    account_status: z.number().optional(),
    disable_reason: z.number().optional(),
    currency: z.string().optional(),
    spend_cap: z.string().optional(),
    amount_spent: z.string().optional(),
    funding_source_details: z
      .object({ type: z.number().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();
