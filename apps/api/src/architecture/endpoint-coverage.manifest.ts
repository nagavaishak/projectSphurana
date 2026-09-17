/**
 * GATE 1 — the coverage manifest.
 *
 * Every mutating endpoint in `apps/api` must be accounted for in exactly one of
 * three ways:
 *
 *   1. `PORT_COVERAGE`  — a capability port method exposes it to orchestrators
 *                         (Claire). This is the destination.
 *   2. `WAIVERS`        — an explicit, dated rule saying "no orchestrator will
 *                         ever call this" (auth, webhooks, upload transport, …).
 *   3. `UNCOVERED_BASELINE` — the burn-down list of what is uncovered TODAY.
 *
 * The list in (3) may only ever SHRINK. A new endpoint that is neither ported
 * nor waived fails the gate, so adding a capability to the API forces a
 * decision about whether Claire can reach it — instead of the decision being
 * made silently by omission and surfacing months later, mid-conversation, to an
 * owner.
 *
 * The list is a coverage measure, NOT a priority list. `sequences` used to score
 * 9 uncovered endpoints here while being dead code — the gate made that gap
 * visible, and the decision it forced was to delete the surface rather than
 * port it. The gate guarantees a gap is visible and has to be decided; it
 * cannot tell you the gap is worth closing.
 *
 * See `docs/engineering/ports-as-capability-contracts.md`.
 */

/**
 * A waiver rule. Rules are evaluated IN ORDER and the first match wins, so a
 * narrower `waived: false` rule can carve an exception out of a broader
 * waiver below it.
 */
export interface WaiverRule {
  /**
   * Matched against the endpoint id (`VERB /route`). A leading `/` matches the
   * route as a prefix for any verb; otherwise the whole `VERB /route` prefix.
   */
  match: string;
  /** Grouping label, used in the gate's summary output. */
  category: string;
  /** Why no orchestrator will call this. Required — "obviously" is not a reason. */
  reason: string;
  /** ISO date the waiver was granted. Waivers are reviewable, not permanent. */
  since: string;
  /** `false` carves an exception out of a broader rule listed later. */
  waived?: boolean;
}

export const WAIVERS: readonly WaiverRule[] = [
  {
    match: 'POST /sales/:id/fulfilment/:status',
    category: 'physical-fulfilment',
    reason:
      'A staff member must confirm that goods were prepared or physically handed to the customer. An orchestrator cannot observe that real-world event, and claiming it occurred would corrupt the order record.',
    since: '2026-09-04',
  },

  // ── Exceptions first (first match wins) ────────────────────────────────────
  {
    match: 'PUT /integrations/instagram/chatbot',
    category: 'chatbot-toggle',
    reason:
      'Turning a channel bot on/off is a business decision an owner asks for in chat — a real capability gap, not integration plumbing. Stays on the burn-down list.',
    since: '2026-07-25',
    waived: false,
  },
  {
    match: 'PUT /integrations/meta-ads-pages',
    category: 'chatbot-toggle',
    reason: 'Per-page chatbot toggle — see above.',
    since: '2026-07-25',
    waived: false,
  },
  {
    match: 'PUT /integrations/whatsapp',
    category: 'chatbot-toggle',
    reason: 'Per-WhatsApp-account chatbot toggle — see above.',
    since: '2026-07-25',
    waived: false,
  },

  // ── In-workspace editing surfaces ─────────────────────────────────────────
  //
  // Both change the copy on a post the owner is looking at, in a screen built
  // to show the change as it lands and let them undo it. Driven by an
  // orchestrator instead, they would rewrite copy on a queue nobody has open —
  // the owner finds out the next time they open it, with no turn to point at.
  // "Rewrite post 3 to be less salesy" is a fair thing to ask Claire; the right
  // answer is to open the workspace, not to edit blind.
  {
    match: 'POST /content-batches/items/:itemId/messages',
    category: 'in-workspace-editing',
    reason:
      "One turn of the per-post review thread: Claire rewrites that post's caption and replies. It only means anything while the owner is watching the post it edits — the workspace shows the new copy immediately and keeps every version in the thread to revert to.",
    since: '2026-07-31',
  },
  {
    match: 'POST /content-batches/items/:itemId/stage-clips',
    category: 'in-workspace-editing',
    reason:
      'The clip list editor saving the order the owner dragged the clips into. It carries the whole list, which is only safe because the card renders every position they are looking at; an orchestrator sending one would be reordering footage it has never seen.',
    since: '2026-08-03',
  },
  {
    match: 'DELETE /content-batches/items/:itemId/staged-edits',
    category: 'in-workspace-editing',
    reason:
      "The card's Reject — it discards an edit the owner made by hand. Meaningful only beside the list it throws away; called from anywhere else it silently undoes their work.",
    since: '2026-08-03',
  },
  {
    match: 'POST /content-batches/items/:itemId/apply-edits',
    category: 'in-workspace-editing',
    reason:
      'Commits the clip and on-screen-text edits the review thread staged, which queues a video render. Batched behind an explicit press precisely so the owner decides when the cost is paid; an orchestrator pressing it would spend render budget on a post nobody has open.',
    since: '2026-08-01',
  },
  {
    match: 'PATCH /content-batches/items/:itemId/caption',
    category: 'in-workspace-editing',
    reason:
      "Rewriting the words published alongside a post. Claire reaches it through `contentBatches_updateItemCaption` rather than a capability port — the review page is the ordinary chat now, so the owner asks for the rewrite while looking at the post. No port method because no orchestrator drives this on its own; it is always a person's sentence.",
    since: '2026-07-31',
  },
  {
    match: 'POST /content-batches/items/:itemId/undo-regenerate',
    category: 'in-workspace-editing',
    reason:
      'Swaps which cut of a post is live. Instant and free, so the cost argument the other waivers lean on does not apply, and generating content is plainly fine for an orchestrator — `graphics_regenerateGraphic` is exposed unconfirmed. The line is ADDITIVE vs REPLACING: that one inserts a new graphic and changes nothing on screen, this one changes what a queued, undecided post shows. Going back only means anything beside the version you went back from, and that comparison exists on the review page. DECIDED 2026-08-01: a batch reaches chat as an artifact linking to that page; the reviewing happens there.',
    since: '2026-08-01',
  },

  // ── Branch assignment (location redesign, phase 2) ────────────────────────
  {
    match: 'POST /organization-services/:id/locations',
    category: 'branch-assignment',
    reason:
      'Adds branches to a service, the additive counterpart of the PUT below — and it deliberately does NOT inherit that waiver\'s hazard: it only inserts, an empty body is rejected rather than meaning "everywhere", and adding a branch to a service that has none is a no-op instead of a silent narrowing. Waived here for the ORCHESTRATOR surface only, and for a plain reason: no orchestrator drives branch assignment. `CatalogPort` reads what the business sells; deciding which branch offers what is catalogue administration a person does in the dashboard. Claire reaches it as a confirm-gated tool (see the area coverage file) — a different consumer from this gate.',
    since: '2026-08-26',
  },
  {
    match: 'POST /membership-plans/:id/locations',
    category: 'branch-assignment',
    reason:
      'Additive counterpart of the PUT below, waived on the same ground as `POST /organization-services/:id/locations`: no orchestrator drives branch assignment.',
    since: '2026-08-26',
  },
  {
    match: 'POST /products/:id/locations',
    category: 'branch-assignment',
    reason:
      'Additive counterpart of `PUT /products/:id/locations`, waived on the same ground. Per-branch QUANTITY is `PUT /products/:id/stock/:locationId` and is unaffected.',
    since: '2026-08-26',
  },
  {
    match: 'POST /offers/:id/locations',
    category: 'branch-assignment',
    reason:
      'Adds branches a promotion runs at. Same ground as the other branch-assignment writes — no orchestrator decides where a discount runs; the person who published it does.',
    since: '2026-08-26',
  },
  {
    match: 'POST /practitioners/:id/locations',
    category: 'branch-assignment',
    reason:
      'Adds branches a practitioner works at — additive, and unable to remove anyone from a branch the way the PUT can. Waived on the same ground as the catalogue writes: no orchestrator makes staffing decisions. An admin does, from the Team page.',
    since: '2026-08-26',
  },
  {
    match: 'DELETE /organization-services/:id/locations/:locationId',
    category: 'branch-assignment',
    reason:
      "Removes ONE branch from a service, the counterpart of the POST above. Waived on the same ground: branch assignment is administration performed from a branch's own page, behind a confirmation that spells out which branches remain.",
    since: '2026-08-26',
  },
  {
    match: 'DELETE /membership-plans/:id/locations/:locationId',
    category: 'branch-assignment',
    reason:
      'Removes ONE branch from a membership plan. Same ground as the service equivalent.',
    since: '2026-08-26',
  },
  {
    match: 'DELETE /products/:id/locations/:locationId',
    category: 'branch-assignment',
    reason:
      'Removes ONE branch from a product. Same ground as the service equivalent; per-branch quantity is a different endpoint.',
    since: '2026-08-26',
  },
  {
    match: 'DELETE /offers/:id/locations/:locationId',
    category: 'branch-assignment',
    reason:
      'Removes ONE branch from a promotion. Same ground as the service equivalent — where a discount runs is decided by the person who published it.',
    since: '2026-08-26',
  },
  {
    match: 'PUT /organization-services/:id/locations',
    category: 'branch-assignment',
    reason:
      'Replaces which branches offer a service, and what each one charges. Withheld for a specific mechanical reason rather than general caution: the endpoint is a full REPLACE whose empty body means "available at EVERY branch", not "none". That is the right default for the read path (zero join rows = everywhere, which is what let these tables ship empty without blanking every catalogue), but it inverts the natural reading of "remove Cork" — an orchestrator that computes the remaining set and sends it would be correct, and one that reasons "clear the list" would silently publish the service everywhere at the org price. Combined with `price_cents_override` being money a customer is then quoted, the failure is both plausible and invisible. Reachable for Claire once the shape is add/remove rather than replace-or-reset.',
    since: '2026-08-25',
  },
  {
    match: 'PUT /membership-plans/:id/locations',
    category: 'branch-assignment',
    reason:
      'Same shape and same reason as `PUT /organization-services/:id/locations` — a full replace whose empty body means "sold at every branch". No price override here, so only half the hazard applies, but the inverted-empty-set reading is the whole of it.',
    since: '2026-08-25',
  },
  {
    match: 'PUT /products/:id/locations',
    category: 'branch-assignment',
    reason:
      'Same shape and same reason as `PUT /organization-services/:id/locations` — a full replace whose empty body means "stocked at every branch". Per-branch QUANTITY is a different endpoint (`PUT /products/:id/stock/:locationId`) and is unaffected by this waiver.',
    since: '2026-08-25',
  },
  // ── Reviewing a website scan before it lands ──────────────────────────────
  //
  // The pair behind the "Scan your website" panel in Organisation details
  // (ENG-659). `preview` diffs a finished scan against the account; `apply`
  // commits the parts the owner ticked. They are two halves of one screen: the
  // diff exists so a human can look at what a scraper believed before it
  // becomes the prices customers are charged and the copy on the booking page.
  {
    match: 'POST /website-analysis/preview',
    category: 'scan-review',
    reason:
      'Renders the diff between a finished scan and the live account. It writes nothing, so an orchestrator calling it achieves nothing on its own — its entire purpose is to put the proposed change in front of the person who has to agree to it.',
    since: '2026-08-02',
  },
  {
    match: 'POST /website-analysis/apply',
    category: 'scan-review',
    reason:
      "Commits that diff: creates services and packages, reprices existing ones, rewrites the public booking-page description and opening hours, and in `replace` mode switches off whatever the scan did not find. Every input is a model's reading of a web page, so a misread price ships straight to what customers are charged. The confirmation step here is the diff, and the diff is a screen.",
    since: '2026-08-02',
  },

  // ── Identity and account management ───────────────────────────────────────
  {
    match: 'POST /practitioners/:id/invite',
    category: 'identity',
    reason:
      'Emails a named person a link that grants them access to the organisation when they accept. That is credential issuance wearing a friendlier name — the same reasoning that waives /auth and /api-keys — and its entire effect is an outbound message to a third party the owner has a relationship with. An orchestrator deciding on its own when to (re-)contact someone about joining is exactly the send nobody approved.',
    since: '2026-08-10',
  },
  {
    match: '/auth',
    category: 'identity',
    reason:
      "Sessions, credentials and email verification. An assistant must never mutate authentication state on a user's behalf.",
    since: '2026-07-25',
  },
  {
    match: '/users',
    category: 'identity',
    reason:
      'User profile/account records — human-owned, same reasoning as /auth.',
    since: '2026-07-25',
  },
  {
    match: '/api-keys',
    category: 'identity',
    reason:
      'Issues and revokes API credentials. Minting a credential is not a delegable capability.',
    since: '2026-07-25',
  },

  {
    match: 'POST /admin-terminal/organizations/:id/stripe/link',
    category: 'onboarding',
    reason:
      'Staff-side twin of the owner\u2019s payments-page action: attaches a Stripe connected account to a workspace from an acct_ id an operator read in the Connect dashboard. Typed once by the human who onboarded that merchant; nothing else knows which account belongs to which business.',
    since: '2026-08-27',
  },
  {
    match: 'POST /billing/subscription/seed',
    category: 'onboarding',
    reason:
      'Attaches a Stripe subscription bought on a sales call to the workspace, from an id an operator read off the Stripe dashboard. Owner/admin only, typed once by a person who was on that call; there is no orchestrator that could know which subscription belongs to which business.',
    since: '2026-08-27',
  },
  {
    match: 'POST /integrations/stripe/link-account',
    category: 'onboarding',
    reason:
      'Binds a Stripe account id, read off the Stripe dashboard by a person during onboarding, to this workspace — the destination every future payout lands in. The id exists nowhere Claire can see it, and a wrong one sends one merchant\u2019s takings to another merchant\u2019s bank account. Typed and confirmed by a human, once.',
    since: '2026-08-27',
  },

  // ── First-run and internal operations ─────────────────────────────────────
  {
    match: '/onboarding',
    category: 'onboarding',
    reason:
      'First-run wizard, driven step-by-step by the human in the browser. Claire is not present until onboarding completes.',
    since: '2026-07-25',
  },
  {
    match: 'PUT /organization-locations/:id/catalog',
    category: 'setup-form',
    reason:
      'The branch setup screen: which practitioners, services, products, plans and promotions a site offers. It is worked through once, against the whole catalogue on screen, and its semantics do not survive being reasoned about a sentence at a time — an empty assignment set means "available at EVERY branch", so the absence of rows reads as the opposite of what it is. No orchestrator should be driving it.',
    since: '2026-08-25',
  },
  {
    match: '/admin-terminal',
    category: 'internal-ops',
    reason: 'Borradh staff-only support console, incl. impersonation.',
    since: '2026-07-25',
  },
  {
    match: '/terminal',
    category: 'internal-ops',
    reason: 'Borradh staff-only operations surface.',
    since: '2026-07-25',
  },
  {
    match: '/debug',
    category: 'internal-ops',
    reason: 'Engineering diagnostics.',
    since: '2026-07-25',
  },
  {
    match: '/analytics/backfill',
    category: 'internal-ops',
    reason: 'Operator-run data backfill job.',
    since: '2026-07-25',
  },
  {
    match: '/claire/admin',
    category: 'internal-ops',
    reason: 'Operator-run business-profile backfill across all orgs.',
    since: '2026-07-25',
  },
  {
    match: '/testing',
    category: 'test-harness',
    reason:
      'E2E seed/cleanup harness, disabled outside non-production environments.',
    since: '2026-07-25',
  },
  // No `/health` waiver: the health controller is read-only, so it never
  // reaches this gate. An unused waiver is itself a gate failure.
  {
    match: '/cdn',
    category: 'infra',
    reason: 'Signed-cookie issuance for CDN media reads — browser transport.',
    since: '2026-07-25',
  },

  // ── Inbound third-party traffic ───────────────────────────────────────────
  {
    match: '/webhooks',
    category: 'inbound-webhook',
    reason:
      'Called BY third parties (Meta, Stripe, Twilio, Resend, Google). Nothing in-process ever calls these.',
    since: '2026-07-25',
  },
  {
    match: '/integrations/facebook/webhook',
    category: 'inbound-webhook',
    reason: 'Meta webhook receiver that predates the /webhooks prefix.',
    since: '2026-07-25',
  },

  // ── End-customer (unauthenticated) surfaces ───────────────────────────────
  {
    match: '/public',
    category: 'end-customer',
    reason:
      "Booking and intake forms submitted by the salon's customers, not by the owner. Claire acts for the owner.",
    since: '2026-07-25',
  },
  {
    match: '/c/',
    category: 'end-customer',
    reason: 'One-click unsubscribe from a campaign message.',
    since: '2026-07-25',
  },

  // ── Transport, not capability ─────────────────────────────────────────────
  {
    match: '/upload',
    category: 'upload-transport',
    reason:
      'Multipart/pre-signed upload plumbing. The capability that matters (what an asset IS) is modelled on the assets surface.',
    since: '2026-07-25',
  },
  {
    match: '/assistant/uploads',
    category: 'upload-transport',
    reason: 'Pre-signed upload URLs for the chat composer.',
    since: '2026-07-25',
  },
  {
    match: 'POST /organization-services/import-csv',
    category: 'upload-transport',
    reason:
      'Carries the BYTES of a spreadsheet the owner exported from their previous booking system — a file only they have, chosen in a file picker. An orchestrator has nothing to send it, and the capability it ultimately exercises (create a service) is already the ported `POST /organization-services`. Same shape as the leads spreadsheet import.',
    since: '2026-08-31',
  },

  // ── The website editor's own surface ──────────────────────────────────────
  {
    match: '/microsites',
    category: 'in-workspace-editing',
    reason:
      "The website builder's own surface: the agent chat turn, the revision history, restore and publish, and the inspector block edit. Every one of these only means anything beside the canvas the owner is looking at — the editing agent that DOES drive them has its own toolset (packages/features/src/microsites/agent) and calls the same services directly, so exposing them to Claire as well would be a second, unsupervised path to the same writes.",
    since: '2026-08-18',
  },

  // ── Claire's own control plane ────────────────────────────────────────────
  {
    match: '/assistant',
    category: 'assistant-control-plane',
    reason:
      'The chat surface itself — conversations, memories, prompt config, WhatsApp linking. Claire runs INSIDE these; she does not call them as tools.',
    since: '2026-07-25',
  },
  {
    match: '/claire',
    category: 'assistant-control-plane',
    reason:
      'Business-profile classification and recommendation dismissal — context Claire is built FROM, driven by the UI around her.',
    since: '2026-07-25',
  },

  // ── Per-user UI state ─────────────────────────────────────────────────────
  {
    match: '/notifications',
    category: 'ui-state',
    reason:
      'Read receipts and device push-token registration. Per-user client state with no business meaning.',
    since: '2026-07-25',
  },
  {
    match: '/notification-preferences',
    category: 'ui-state',
    reason: 'Per-user notification settings.',
    since: '2026-07-25',
  },
  {
    match: '/training-hub',
    category: 'ui-state',
    reason: 'Per-user video watch progress.',
    since: '2026-07-25',
  },

  // ── Campaigns: composer-internal endpoints ────────────────────────────────
  {
    match: 'POST /campaigns/segments/sample-recipients',
    category: 'composer-preview',
    reason:
      'Read-shaped POST that returns a handful of sample lead rows purely to drive the composer’s live mail-merge preview (the body is too large for a query string). No orchestrator needs it — Claire uses previewAudience for counts — and it returns contact PII that should not enter a conversation.',
    since: '2026-08-09',
  },
  {
    match: 'POST /campaigns/whatsapp-templates/ensure',
    category: 'composer-preview',
    reason:
      'Idempotent, one-time provisioning that registers the canonical bulk-message template on the org’s WABA the first time the composer opens WhatsApp. A UI setup step, not a conversational action — Claire composes with the already-approved template via listWhatsappTemplates/setMessage.',
    since: '2026-08-09',
  },

  // ── External API mirror ───────────────────────────────────────────────────
  {
    match: '/v1',
    category: 'external-api',
    reason:
      'API-key surface for third-party integrators. It mirrors internal endpoints, which are themselves tracked here — covering both would double-count the same capability.',
    since: '2026-07-25',
  },

  // ── Patient portal (ENG-647) ──────────────────────────────────────────────
  //
  // A second principal type: the clinic's CUSTOMER, in their own session, on
  // their own record. Orchestrators act for the BUSINESS and cannot hold a
  // patient session — so no orchestrator will ever call these, by construction
  // rather than by policy. See apps/api/src/assistant/tools/patient/coverage.ts
  // for the same boundary drawn on the Claire-tool side.
  {
    match: '/patient',
    category: 'patient-portal',
    reason:
      "Acts for one patient, authorised by a patient_session an orchestrator cannot hold. The writes are that person's own acts — signing consent (a legal attestation with their typed name, timestamp and IP), cancelling their own booking, uploading to their own vault. The staff equivalents are separately tracked and are the path the business takes.",
    since: '2026-08-06',
  },
  {
    match: 'POST /patient-portal-access/:leadId',
    category: 'patient-portal',
    reason:
      "Staff 'Copy portal link': mints a single-use DIRECT SIGN-IN credential into one patient's portal record. Minting a credential is not a delegable capability (the same line that keeps /api-keys out), and the button exists so a human sees the it-signs-them-straight-in warning at the moment they copy it — an orchestrator handing the link onward would strip that moment out.",
    since: '2026-08-11',
  },
  {
    match: '/consent-form-templates',
    category: 'patient-portal',
    reason:
      'Authors the consent instruments patients are asked to attest to, and sets which treatments require them. The body text is drafted deliberately from clinical or insurer wording; dropping a requirement silently stops collecting a consent. Both are compliance acts a human owns, not capabilities to reach through an orchestrator.',
    since: '2026-08-06',
  },
  {
    match: 'POST /leads/:leadId/documents',
    category: 'patient-portal',
    reason:
      "Staff-side clinical document vault. Uploader identity is provenance on a care record — a row written by an orchestrator would claim a named staff member filed something they never saw. Presign mints write credentials into a patient's clinical folder.",
    since: '2026-08-06',
  },
  {
    match: '/document-imports',
    category: 'patient-portal',
    reason:
      "Bulk staging of clinical files into client vaults (ENG-784). Presign mints write credentials into clinical storage; complete and assign record a clinical document under a named staff uploader — provenance on a care record; discard drops a client's paperwork. The same boundary as POST/DELETE /leads/:leadId/documents, entered in bulk.",
    since: '2026-08-20',
  },
  {
    match: 'DELETE /leads/:leadId/documents',
    category: 'patient-portal',
    reason:
      'Removing a document from a care record has retention consequences and is reversible only from a backup — the same reasoning that keeps DELETE /leads/:id out, with more force.',
    since: '2026-08-06',
  },
];

/**
 * Endpoints reachable through a capability port, keyed by endpoint id.
 *
 * The value names a method on a port declared in
 * `packages/contracts/src/ports/`. The gate verifies the method actually
 * exists, so deleting a port method breaks Gate 1 as well as Gate 2.
 */
export const PORT_COVERAGE: Readonly<Record<string, string>> = {
  'POST /videos': 'VideosPort.createDraft',
  'PATCH /videos/:id/draft-config': 'VideosPort.patchDraft',
  'POST /videos/:id/export': 'VideosPort.export',
  'POST /videos/:id/retry': 'VideosPort.export',
  'PUT /meta-campaigns/:metaCampaignId': 'MetaAdsPort.updateBudget',
  'POST /lead-forms': 'LeadFormsPort.create',
  'PUT /lead-forms/:id': 'LeadFormsPort.update',
  'PUT /meta-ads/:id': 'MetaAdsPort.updateAd',
  // Rooms & equipment. Every mutating endpoint is ported, because rooms are
  // now a SECOND availability source: once a service requires one, a
  // misconfigured room makes it unbookable exactly as a missing rota does —
  // the case this gate's own header cites for `shifts`.
  //
  // `ResourcesPort`'s create/update requests are NARROWER than their
  // endpoints: `color`, `photo`, `specs` and `sortOrder` are not on them.
  // That is a deliberate narrowing of reach, not a partial capability — every
  // field that decides whether a room can be BOOKED is exposed, and ordering
  // has its own method. (Contrast `POST /ai-content/generate` below, which is
  // NOT claimed because the port covers only one of the several different
  // things that endpoint does.)
  'POST /resources/categories': 'ResourcesPort.createCategory',
  'PUT /resources/categories/:id': 'ResourcesPort.updateCategory',
  'DELETE /resources/categories/:id': 'ResourcesPort.deleteCategory',
  'POST /resources': 'ResourcesPort.createResource',
  'PUT /resources/:id': 'ResourcesPort.updateResource',
  'DELETE /resources/:id': 'ResourcesPort.deleteResource',
  'PUT /resources/reorder': 'ResourcesPort.reorderResources',
  'PUT /resources/requirements/:serviceId':
    'ResourcesPort.setServiceRequirements',
  // Lives on the appointments controller (it writes an appointment's holds),
  // but it is a ROOMS capability — the port that owns rooms owns it.
  'PUT /appointments/:id/resources': 'ResourcesPort.setAppointmentResource',
  // NOT listed: `POST /ai-content/generate`. `MetaAdsPort.generateAdCopy` calls
  // it, but only for `contentType: 'ad_copy'`. The endpoint also serves post
  // captions, offer copy and blog content, so claiming it as covered would
  // report a capability surface the port does not expose. It stays in
  // UNCOVERED_BASELINE until either the endpoint is split or a port covers the
  // rest of it.
};

/**
 * RATCHET BASELINE — mutating endpoints that are neither ported nor waived
 * TODAY. This list may only SHRINK.
 *
 *   - A NEW uncovered endpoint → gate FAILS. Port it, or waive it with a
 *     reason and a date. Do not append here to make the gate pass.
 *   - An entry that becomes covered or waived, or whose endpoint is deleted,
 *     without being removed from this list → gate FAILS (stale baseline), so a
 *     fix cannot silently regress later.
 *
 * Regenerate (only when it shrinks):
 *   UPDATE_ENDPOINT_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest endpoint-coverage
 */
export const UNCOVERED_BASELINE: ReadonlySet<string> = new Set([
  'DELETE /appointments/:id',
  'DELETE /assets/:id',
  'DELETE /assets/:id/services',
  'DELETE /assets/:id/tags',
  'DELETE /blocked-time-types/:id',
  'DELETE /blocked-time/:id',
  'DELETE /campaigns/:id',
  'DELETE /campaigns/segments/:id',
  'DELETE /content-batches/current',
  'DELETE /conversations/:id',
  'DELETE /graphics/:id',
  'DELETE /intake-forms/:id',
  'DELETE /integrations/booking/accounts/:id',
  'DELETE /integrations/calendar/accounts/:id',
  'DELETE /integrations/email/accounts/:id',
  'DELETE /integrations/google-my-business/accounts/:id',
  'DELETE /integrations/instagram/integration',
  'DELETE /integrations/meta-ads/integration',
  'DELETE /integrations/meta-ads/pages/:pageId',
  'DELETE /integrations/stripe/integration',
  'DELETE /integrations/whatsapp/accounts/:id',
  'DELETE /integrations/whatsapp/accounts/:id/templates/:templateName',
  'DELETE /lead-forms/:id',
  'DELETE /leads/:id',
  'DELETE /locations/:locationId/opening-hours/exceptions/:date',
  'DELETE /membership-plans/:id',
  'DELETE /meta-ads/:id',
  'DELETE /meta-campaigns/:metaCampaignId',
  'DELETE /offers/:id',
  'DELETE /organization-locations/:id',
  'DELETE /organization-services/:id',
  'DELETE /organization-services/variants/:variantId',
  'DELETE /organizations/:id/members/:userId',
  'DELETE /packages/:id',
  'DELETE /packages/:id/items/:itemId',
  'DELETE /phone-numbers/:id',
  'DELETE /practitioners/:id',
  'DELETE /product-brands/:id',
  'DELETE /product-categories/:id',
  'DELETE /products/:id',
  'DELETE /sales/:id/items/:itemId',
  'DELETE /service-categories/:id',
  'DELETE /shifts/override/:practitionerId/:date',
  'DELETE /social-posts/:id',
  'DELETE /suppliers/:id',
  'DELETE /time-entries/:id',
  'DELETE /time-off/:id',
  'DELETE /venue/photos/:id',
  'DELETE /videos/:id',
  'DELETE /voice-scripts/:id',
  'PATCH /leads/:id/status',
  'PATCH /org-defaults',
  'PATCH /organization/active',
  'POST /ai-content/generate',
  'POST /ai-content/generate-offer-content',
  'POST /ai-content/generate-offer-copy',
  'POST /appointments',
  'POST /appointments/open-slots',
  'POST /assets',
  'POST /assets/:id/analyze',
  'POST /assets/:id/reprobe',
  'POST /assets/:id/services',
  'POST /assets/:id/tags',
  'POST /assets/batch',
  'POST /billing/credits/checkout',
  'POST /billing/portal',
  'POST /billing/subscription/cancel',
  'POST /billing/subscription/checkout',
  'POST /billing/webhook',
  'POST /blocked-time',
  'POST /blocked-time-types',
  'POST /campaigns',
  'POST /campaigns/:id/cancel',
  'POST /campaigns/:id/launch',
  'POST /campaigns/:id/messages',
  'POST /campaigns/:id/resume',
  'POST /campaigns/draft-content',
  'POST /campaigns/draft-content/stream',
  'POST /campaigns/segments',
  'POST /campaigns/segments/preview',
  'POST /campaigns/sms-number',
  'POST /chatbots/test-chat',
  'POST /content-batches/generate',
  'POST /content-batches/items/:itemId/accept',
  'POST /content-batches/items/:itemId/regenerate',
  'POST /content-batches/items/:itemId/reject',
  'POST /conversations/:id/assign',
  'POST /conversations/:id/close',
  'POST /conversations/:id/escalate',
  'POST /conversations/:id/messages',
  'POST /conversations/sync',
  'POST /deposits',
  'POST /deposits/:id/cancel',
  'POST /deposits/:id/refund',
  'POST /face-groups/manual-pair',
  'POST /gift-cards/:id/adjust',
  'POST /graphics/:id/outputs/confirm',
  'POST /graphics/:id/outputs/upload-url',
  'POST /graphics/:id/regenerate',
  'POST /graphics/generate',
  'POST /intake-forms',
  'POST /intake-forms/issue',
  'POST /intake-forms/seed-templates',
  'POST /integrations/booking/accounts/:id/import-team-members',
  'POST /integrations/booking/connect/phorest',
  'POST /integrations/facebook/subscribe-page',
  'POST /integrations/google-my-business/accounts/:id/sync',
  'POST /integrations/instagram/fix-user-ids',
  'POST /integrations/instagram/subscribe-webhooks',
  'POST /integrations/meta-ads/ad-accounts',
  'POST /integrations/meta-ads/configure',
  'POST /integrations/meta-ads/connect',
  'POST /integrations/meta-ads/initiate',
  'POST /integrations/meta-ads/lead-forms',
  'POST /integrations/meta-ads/pages#addOrgMetaAdsPage',
  'POST /integrations/meta-ads/pages#getMetaPages',
  'POST /integrations/stripe/account-link',
  'POST /integrations/stripe/account-refresh',
  'POST /integrations/stripe/account-session',
  'POST /integrations/voice/book',
  'POST /integrations/whatsapp/accounts/:id/templates',
  'POST /integrations/whatsapp/finalize',
  'POST /lead-forms/:id/sync',
  'POST /lead-memberships/:id/cancel',
  'POST /leads',
  'POST /leads/import',
  'POST /leads/import-csv',
  'POST /membership-plans',
  'POST /meta-ads',
  'POST /meta-ads/:id/duplicate',
  'POST /meta-ads/:id/promote-draft',
  'POST /meta-ads/:id/publish',
  'POST /meta-ads/:id/sync',
  'POST /meta-ads/import',
  'POST /meta-ads/launch',
  'POST /meta-ads/launch-from-post',
  'POST /meta-ads/webhook',
  'POST /meta-campaigns',
  'POST /meta-campaigns/:metaCampaignId/duplicate',
  'POST /meta-campaigns/:metaCampaignId/pause',
  'POST /meta-campaigns/:metaCampaignId/resume',
  'POST /meta-campaigns/sync-all',
  'POST /offers',
  'POST /offers/:id/promote-draft',
  'POST /organization-locations',
  'POST /organization-locations/:id/set-primary',
  'POST /organization-services',
  'POST /organization-services/:serviceId/variants',
  'POST /organization-services/seed',
  'POST /organization/active',
  'POST /organization/onboarding-tasks/complete',
  'POST /organizations',
  'POST /organizations/:id/invitations',
  'POST /organizations/invitations/:invitationId/accept',
  'POST /packages',
  'POST /packages/:id/items',
  'POST /packages/:id/items/reorder',
  'POST /payments',
  'POST /payments/:id/refund',
  'POST /phone-numbers',
  'POST /phone-numbers/buy',
  'POST /practitioners',
  'POST /practitioners/:id/complete-profile-setup',
  'POST /practitioners/link-me',
  'POST /practitioners/team-member',
  'POST /product-brands',
  'POST /product-categories',
  'POST /products',
  'POST /sales',
  'POST /sales/:id/complete',
  'POST /sales/:id/items',
  'POST /sales/:id/payments',
  'POST /sales/:id/payments/:paymentId/cancel',
  'POST /sales/:id/payments/:paymentId/settle-card',
  'POST /sales/:id/void',
  'POST /sales/from-appointment',
  'POST /service-categories',
  'POST /service-categories/reorder',
  'POST /social-posts',
  'POST /social-posts/:id/publish',
  'POST /social-posts/sync',
  'POST /stock-orders',
  'POST /stock-orders/:id/cancel',
  'POST /stock-orders/:id/receive',
  'POST /stock-takes',
  'POST /stock-takes/:id/cancel',
  'POST /stock-takes/:id/complete',
  'POST /suppliers',
  'POST /time-entries/:id/approve',
  'POST /time-entries/:id/breaks',
  'POST /time-entries/:id/clock-out',
  'POST /time-entries/clock-in',
  'POST /time-off',
  'POST /venue/photos',
  'POST /venue/photos/cover',
  'POST /venue/photos/reorder',
  'POST /videos/:id/clips',
  'POST /videos/:id/draft-clips',
  'POST /videos/:id/synthesize',
  'POST /videos/:id/transcribe',
  'POST /videos/admin/cleanup-orphaned-assets',
  'POST /videos/admin/dlq/:jobId/retry',
  'POST /videos/generate-organic-copy',
  'POST /videos/generate-script',
  'POST /videos/stock-clips/mint',
  'POST /videos/template-preview',
  'POST /voice-cloning/admin/ingest',
  'POST /voice-cloning/admin/status',
  'POST /voice-cloning/ingest',
  'POST /voice-scripts',
  'POST /website-analysis/analyze',
  'POST /website-analysis/analyze/start',
  'POST /website-analysis/debug-content',
  'PUT /appointments/:id',
  'PUT /assets/:id/content-type',
  'PUT /assets/:id/tags',
  'PUT /blocked-time-types/:id',
  'PUT /blocked-time/:id',
  'PUT /campaigns/:id',
  'PUT /campaigns/segments/:id',
  'PUT /face-groups/:groupId',
  'PUT /face-groups/:groupId/assets/:assetId/role',
  'PUT /graphics/:id',
  'PUT /intake-forms/:id',
  'PUT /intake-forms/services/:serviceId/forms',
  'PUT /integrations/calendar/accounts/:id',
  'PUT /integrations/instagram/chatbot',
  'PUT /integrations/meta-ads-pages/:pageId/chatbot',
  'PUT /integrations/meta-ads/default-lead-form',
  'PUT /integrations/meta-ads/pages/:pageId/default',
  'PUT /integrations/whatsapp/:accountId/chatbot',
  'PUT /leads/:id',
  'PUT /locations/:locationId/opening-hours/exceptions/:date',
  'PUT /locations/:locationId/opening-hours/standing',
  'PUT /membership-plans/:id',
  'PUT /meta-ads/:id/creative',
  'PUT /offers/:id',
  'PUT /organization-locations/:id',
  'PUT /organization-services/:id',
  'PUT /organization-services/:serviceId/variants/reorder',
  'PUT /organization-services/variants/:variantId',
  'PUT /organizations/:id/chatbot-settings',
  'PUT /packages/:id',
  'PUT /packages/:id/items/:itemId',
  'PUT /practitioners/:id',
  'PUT /practitioners/:id/locations',
  'PUT /practitioners/:id/services',
  'PUT /product-brands/:id',
  'PUT /product-categories/:id',
  'PUT /products/:id',
  'PUT /products/:id/stock/:locationId',
  'PUT /sales/:id/client',
  'PUT /sales/:id/tip',
  'PUT /service-categories/:id',
  'PUT /shifts/override/:practitionerId',
  'PUT /shifts/weekly/:practitionerId',
  'PUT /social-posts/:id',
  'PUT /stock-orders/:id',
  'PUT /stock-takes/:id/items',
  'PUT /suppliers/:id',
  'PUT /time-entries/:id',
  'PUT /time-off/:id',
  'PUT /venue/:locationId',
  'PUT /videos/:id',
  'PUT /videos/:id/draft-clips',
  'PUT /voice-scripts/:id',
  'PUT /wage-configs/:practitionerId',
]);
