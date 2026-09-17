/**
 * Skill registry — barrel.
 *
 * ---------------------------------------------------------------------------
 * Skill prompt template: one-prompt-with-defaults
 * ---------------------------------------------------------------------------
 *
 * Every creation skill follows the same shape. If your skill diverges from
 * this template, the design is wrong, not the template — see
 * `docs/implementations/claire-creation-redesign.md` for the rationale.
 *
 * 1. Default aggressively, never ask preference questions during creation.
 *    Pull per-org defaults from `getOrgDefaults` (W1 partial-defaults
 *    service). If a value isn't in the defaults, pick a sensible system
 *    fallback and proceed. The user iterates after the thing exists; they
 *    don't answer a survey before it does.
 *
 * 2. Confirmation only at the destructive boundary.
 *    Spending money (launching ads), publishing externally (posting to
 *    Meta), or sending messages → confirm. Drafts, paused campaigns,
 *    queued renders → just do it. The factory's `destructive: true` flag
 *    is the right tool — drop it for paused/draft-only flows.
 *
 * 3. Iterate in chat after creation, not via blocking questions before it.
 *    Result cards expose inline edits ("change budget", "swap clip", "make
 *    it portrait") that re-prompt Claire with patch instructions against
 *    the existing draft. Never block creation on iteration questions.
 *
 * 4. One allowed clarifying question pattern: missing prerequisites.
 *    No Meta connection? No services in the org? Ask one targeted
 *    question — to resolve the prerequisite, not to gather a preference.
 *    Everything else is a default the system should already know.
 *
 * Skill→tool wiring is validated at build time by `skills.test.ts` (via
 * `validateSkillToolNames` in `wiring.ts`). The controller logs an error if
 * a skill references an unregistered tool at runtime, but the test is the
 * authoritative check — see the `createCampaign` drift incident that
 * prompted this redesign.
 * ---------------------------------------------------------------------------
 */
import { createAdSkill } from './create-ad.skill.js';
import { createCampaignSkill } from './create-campaign.skill.js';
import { createOfferAndPromoteV1Skill } from './create-offer-and-promote-v1.skill.js';
import { defaultSkill } from './default.skill.js';
import { generateGraphicSkill } from './generate-graphic.skill.js';
import { generateVideoSkill } from './generate-video.skill.js';
import { manageAppointmentsSkill } from './manage-appointments.skill.js';
import { manageCampaignsSkill } from './manage-campaigns.skill.js';
import { manageCustomerChatsSkill } from './manage-customer-chats.skill.js';
import { manageDefaultsSkill } from './manage-defaults.skill.js';
import { manageLeadFormsSkill } from './manage-lead-forms.skill.js';
import { manageLeadsSkill } from './manage-leads.skill.js';
import { manageMessagingCampaignsSkill } from './manage-messaging-campaigns.skill.js';
import { manageOffersSkill } from './manage-offers.skill.js';
import { manageServicesSkill } from './manage-services.skill.js';
import { optimiseAdsSkill } from './optimise-ads.skill.js';
import { pauseAdSkill } from './pause-ad.skill.js';
import { respondToLowCplSkill } from './respond-to-low-cpl.skill.js';
import { reviewContentSkill } from './review-content.skill.js';
import { schedulePostSkill } from './schedule-post.skill.js';
import type { SkillModule } from './types.js';
import { updateBudgetSkill } from './update-budget.skill.js';
import { weeklyMarketingReviewSkill } from './weekly-marketing-review.skill.js';

/**
 * Skill registry version — bump by hand whenever skill content changes
 * materially (prompt fragments, tool lists, hard blocks). Pinned per
 * conversation so in-flight conversations run against frozen prompts even
 * after a deploy.
 *
 * History:
 *   1 — initial registry (W-C03-A) with `manage-*` skills as stubs
 *   2 — manage-appointments filled (W-C07): prompt fragment + 6 tool names
 *   3 — manage-leads filled (W-C06): prompt fragment + 5 tool names
 *   4 — manage-offers filled (W-C08): prompt fragment + 5 tool names + hard blocks
 *   5 — manage-customer-chats filled (W-C09-tools): prompt fragment + 8 tool names + hard block
 *   6 — create-offer-and-promote-v1 added (W-C15-promote-flow): first composite
 *       cross-feature skill, opus-routed with extended thinking; orchestrates
 *       manage-offers → generate-video → schedule-post via meta_loadSkill
 *   7 — weekly-marketing-review added (W-C15-weekly-review): second composite
 *       cross-feature skill, opus-routed with extended thinking; orchestrates
 *       manage-leads + optimise-ads + manage-customer-chats + manage-appointments
 *       summary tools into a tight 4-section weekly read
 *   8 — respond-to-low-cpl added (W-C15-cpl-response): third composite
 *       cross-feature skill, opus-routed with extended thinking; diagnoses
 *       ad performance via optimise-ads, then routes the operator to
 *       pause-ad / update-budget / generate-video on the right branch of
 *       the decision tree
 *   9 — generate-video skill rewritten (W-C10-clip-tray): drops the
 *       auto-vs-manual fork at step 4, replaces with tray-aware "read tray,
 *       contribute additively" guidance; toolNames extends with
 *       `listDraftClips`. autoSelectClips inputSchema gains `excludeIds` +
 *       `fillToCount` (additive — older recordings still resolve).
 *  10 — audit fixes (Claire_CRUD_Audit): createLead/updateLead added to
 *       manage-leads; sendReply added to manage-customer-chats;
 *       schedulePost/publishPostNow replace legacy confirm/execute pairs in
 *       schedule-post; createCampaign added to create-ad; deleteDraftVideo
 *       added to generate-video; manage-services skill added.
 *  11 — delete tools (Claire_CRUD_Audit follow-up): deleteDraftAd added to
 *       create-ad; deleteSocialPostDraft added to schedule-post;
 *       deleteService added to manage-services.
 *  12 — manage-defaults skill added (Claire Creation Redesign W5): exposes
 *       \`setOrgDefault\` for the "make this my default" affordance on
 *       Created cards and direct "set my default X" asks.
 *  13 — create-campaign skill added; create-ad rewritten to ask "existing
 *       campaign or new one?" when there are existing campaigns. Both flows
 *       default to messaging (chatbot) + WhatsApp-when-connected, mirroring
 *       the Create Campaign modal. \`createCampaign\` tool rewritten to hide
 *       Meta's \`OUTCOME_*\` enums from the LLM (followUpType is the human
 *       surface) and to render friendly card labels.
 *  14 — \`previewCampaign\` tool added; create-campaign skill enforces a
 *       preview-then-approve flow (turn 1: previewCampaign + echo defaults
 *       in chat, turn 2: createCampaign after operator approves). Mirrors
 *       the Create Campaign modal's "see fields → click Create" UX in chat.
 *       Also fixes a crash in \`createCampaign\` where the API response was
 *       assumed to echo name/status/dailyBudget — it doesn't; the Created
 *       card now uses the input values and a hardcoded "paused" status.
 *  15 — \`previewCampaign\` now renders a persistent Campaign-preview card
 *       (\`uiState: 'created' + variant: 'preview'\`) via the frontend's
 *       generic dispatch, so the preview survives a page refresh. Skill
 *       prompt updated: Claire reads the card; her chat message is one
 *       short line ("Create with these defaults, or change something?").
 *  16 — \`previewCampaign\` default name is now date-stamped and unique
 *       ("Campaign — 17 May 2026 14:23") instead of "New campaign", so
 *       multiple "create a campaign" requests in a session produce
 *       distinguishable names in the Meta dashboard. Skill prompt teaches
 *       Claire to derive a name from user context when present, and to
 *       omit \`requestedName\` (letting the tool default fire) when not.
 *  17 — generate-video skill rewritten to a strict two-turn / one-
 *       confirmation shape. Turn 1: \`createDraftVideo\` immediately (no
 *       text proposal preamble) — the returned card *is* the review.
 *       Turn 2: user says "yes" / "render it" → \`executeVideoExport\`
 *       directly with just \`{ videoId }\`. The Approve/Reject button
 *       step is GONE for the textual-confirmation path: typing yes is
 *       the approval, no clicking on top of it. \`executeVideoExportTool\`
 *       now treats \`confirmationToken\` as optional — when omitted, the
 *       token verification is skipped and the render queues directly.
 *       \`queueVideoExport\` is still available for cases where Claire is
 *       proposing a render unprompted (e.g. after a patch) and wants the
 *       button-confirm safety, but it's no longer the default. The
 *       frontend \`tool-renderer\` (both apps/web + apps/app) mounts
 *       \`ProcessingStatus\` directly off the \`executeVideoExport\` output
 *       so the loading card appears the instant the render queues, no
 *       \`getVideoStatus\` follow-up needed. \`createDraftVideoTool\` no
 *       longer auto-renders (defaults \`autoRender:false\`) and surfaces
 *       the resolved defaults as card fields. Action buttons removed
 *       from create + patch cards (next action is a chat question, same
 *       rule as createCampaign). \`deleteDraftVideoTool\` registered in
 *       \`videosTools\`. \`listServicesTool\` now passes \`?limit=100\`.
 *  18 — \`createDraftVideoTool\` requires \`serviceId\` (was optional).
 *       Skill prompt now mandates a \`listServices\` call before every
 *       create — even when the user didn't name a service, Claire picks
 *       the strongest match and proceeds (no "which service?" question).
 *       Without a service the AI script generator can't fill the template
 *       placeholders, and text_only renders show literal "[PAIN POINT]"
 *       on screen. POST /videos in apps/api now also runs
 *       \`generateVideoScript\` server-side when the synth script has
 *       placeholder tokens AND a serviceId is provided, then re-derives
 *       textFrames from the AI script. Preview card surfaces the resolved
 *       on-screen text frames per-frame with style badges (Hook / Body /
 *       CTA / Disclaimer) so the user sees exactly what will render.
 *       Synth's \`mapOrientation\` coerces landscape → portrait — Claire
 *       drafts never render landscape (wizard flow unchanged).
 *  19 — \`requestSupportChat\` tool added to the default skill. Claire offers
 *       a live human handoff when the owner asks for support, when she hits
 *       a topic outside her scope, or when she's tried twice and is stuck.
 *       The tool creates an Intercom conversation seeded with the recent
 *       transcript, flips the Claire conversation to \`escalated\`, and
 *       stores the linked \`intercomConversationId\`. Back-and-forth happens
 *       in the Intercom messenger — the Claire UI shows the "Open support
 *       chat" card and an escalation banner.
 *  20 — \`manage-campaigns\` skill added — campaign management as a standalone
 *       activity (list / view / set up campaigns when the user isn't in the
 *       middle of launching a specific ad). Sits alongside \`create-campaign\`
 *       (which is the inline create-step inside the create-ad flow); the
 *       classifier picks one based on intent.
 *  21 — \`generate-graphic\` skill added — one-prompt social graphic creation
 *       mirroring \`generate-video\` minus the render-confirmation split.
 *       Exposes \`listServices\` + \`createGraphic\` (\`graphics_createGraphic\`),
 *       which POSTs /graphics/generate and returns a self-polling card that
 *       swaps to the rendered image when the worker finishes.
 *  22 — V2 acquisition flow + intro offers (\`offers_suggestIntroOffer\` tool).
 *       \`create-campaign\` rewritten from "just the container" into the
 *       two-step offer-first journey (intro offer + campaign → offer video +
 *       graphic + captions → launch); defaults to the offer format and the
 *       locked pain-point → service → offer ad structure; asks city vs
 *       countryside once and stores it on \`org_defaults.ad_area_type\` (new
 *       column) to set the targeting radius (city→20km, countryside→40km);
 *       campaign preview now shows the org's real address. \`generate-video\`
 *       and \`manage-offers\` gain \`suggestIntroOffer\` (+ \`listOffers\` /
 *       \`createOffer\` on generate-video) so "make an offer video" runs the
 *       intro-offer flow. \`setOrgDefault\` gains the \`adAreaType\` key.
 *       \`createDraftVideo\` now accepts \`offer\` and \`before_after\` formats.
 *       Default skill: first-person lead-flow ownership + name-a-service-I-
 *       wouldn't-lead-with disagreement handling.
 *   v23: paid-ad graphics. \`create-campaign\` now builds the offer graphic via
 *       \`createAdGraphic\` (\`graphics_createAdGraphic\`, \`{ serviceId, offerId }\`)
 *       instead of \`createGraphic\` — an offer-aware ad template pool composes
 *       the badge/treatment/benefits/CTA from the offer.
 *   v24: \`create-campaign\` gains \`createDraftAd\`. Step 2 now renders the offer
 *       video + graphic as suppressed creatives (\`suppressCard: true\`), writes
 *       the ad copy once, then creates TWO draft ads (video + graphic) sharing
 *       the copy. Each renders a combined media-on-top + copy-beneath card that
 *       skeletons until its creative finishes. Drafts only — nothing publishes
 *       to Meta until launch.
 *   v25: \`create-campaign\` gains \`confirmLaunchAd\` + \`executeLaunchAd\` so it can
 *       launch the ads it just built in-context (when the owner answers the
 *       "ready to launch?" nudge) — without a \`meta_loadSkill\` hand-off that
 *       cancelled the in-flight launch. It chains confirm → execute per ad on
 *       the verbal yes (no second card click).
 *   v26: \`create-campaign\` drops \`confirmLaunchAd\` and launches each ad with a
 *       SINGLE direct \`executeLaunchAd\` call (no confirmationToken). The owner
 *       already approved verbally via the "ready to launch?" nudge, so the
 *       confirm step was a redundant second ask AND the confirm→execute chain
 *       was racing/cancelling. \`executeLaunchAd\` now runs the launch hard-blocks
 *       inline when called token-less. (\`create-ad\` keeps the button-confirm
 *       two-tool flow.)
 *   v27: PRD-1 Campaign Troubleshooting Framework. \`respond-to-low-cpl\` prompt
 *       rewritten to encode the doc's full diagnostic sequence: the €80 spend
 *       gate (Step 1), the high-intent lead check (Step 2) branching into 3A
 *       (leads exist, not booking → price/friction/response-time) vs 3B (no
 *       leads → branch by service tier), the offer-adjust → creative-refresh →
 *       escalate-after-2-rounds lifecycle, the €10/€10-19/€20+ budget bands,
 *       the ROI reframe, emotional-complaint handling, and the speed-to-lead
 *       "cheaper elsewhere" rebuttal. \`optimise-ads\` gains the new
 *       \`diagnoseCampaign\` deterministic tool (the skill calls it FIRST,
 *       before responding to any "isn't working" complaint) so the reactive
 *       skill and the proactive \`fourDayNoLeads\` trigger share one diagnostic
 *       source of truth. \`respond-to-low-cpl\` stays a composite (toolNames []),
 *       pulling \`diagnoseCampaign\` in via \`load_skill('optimise-ads')\`.
 *   v28: Lead-form-first acquisition. \`create-campaign\` now defaults to a LEAD
 *       FORM (built via the new \`createLeadForm\` tool, synced to Meta) whose
 *       thank-you button drops leads into a COUNTRY-DRIVEN chat channel — US →
 *       Messenger, UK/Ireland → WhatsApp (WhatsApp needs a connection, else it
 *       flags + falls back to Messenger). Claire tells the owner most leads land
 *       in {Messenger/WhatsApp} and that she handles them. Chatbot/click-to-chat
 *       is kept as the fallback when the org can't run a form (no privacy-policy
 *       URL). New \`manage-lead-forms\` skill (+ \`listLeadForms\`/\`previewLeadForm\`/
 *       \`createLeadForm\`/\`updateLeadForm\` tools) lets owners view/build/edit
 *       forms outside a campaign. \`previewCampaign\` defaults followUpType to
 *       lead_form and surfaces \`nurtureChannel\`.
 *   v29: Default lead forms now include a multiple-choice "how soon are you
 *       hoping to get this treatment done?" question (ASAP / 1 week / 2 weeks)
 *       so clinics can prioritise hot leads — applied on both the
 *       \`create-campaign\` default path and the manual builder. Human escalation
 *       no longer opens an Intercom chat: \`requestSupportChat\` is removed from
 *       the default skill (and the assistant toolset) and Claire instead points
 *       the owner to email senan@borradh.io. \`create-campaign\` also reassures
 *       the owner that backend targeting + optimisation are handled.
 *   v30: \`generate-graphic\` can now EDIT existing graphics, not just create
 *       them. Two new tools: \`listRecentGraphics\` (context — find a graphic to
 *       act on, mirrors \`listRecentVideos\`) and \`regenerateGraphic\` (graphics —
 *       wraps \`POST /graphics/:id/regenerate\`; template-pinned, refinement-
 *       aware, with \`scope:'slide'\` for per-slide carousel refine). The skill
 *       gains an "Editing an existing graphic" path (find → regenerate, same
 *       one-call discipline as creation).
 *   v31: Fewer-steps pass — build with defaults, confirm only at real
 *       money/external/customer-irreversible boundaries. \`create-campaign\`
 *       drops its preview-and-approve gate: once the service is agreed and
 *       the regular price is known, Claire builds offer + lead form +
 *       campaign + video + graphic + draft ads back to back, and the only
 *       deliberate gate is the existing "ready to launch?". The same
 *       surface-and-ask gate is removed from the configuration/CRM skills:
 *       \`create-ad\` (paused campaign container created without a preview),
 *       \`manage-campaigns\` (paused container, no confirm), \`manage-offers\`
 *       (intro + other offers + extend created immediately; only EXPIRE
 *       stays gated), \`manage-services\` (create/update immediately; only
 *       DELETE gated), \`manage-leads\` (create/update immediately; only
 *       assign-to-sequence gated), \`manage-appointments\` (book/reschedule
 *       immediately; only CANCEL gated), \`manage-lead-forms\` (build/edit
 *       immediately; live-form relink caveat stays). Ambiguous inputs
 *       (catchment, nurture-channel fallback) no longer stop a build —
 *       Claire picks the sensible default and notes it in one closing line
 *       for the owner to correct on the finished result. KEPT gated:
 *       launch/pause ads, budget increases, schedule/publish posts, customer
 *       messages + escalation, sequence assignment, appointment cancels,
 *       service deletes. Same toolset throughout; faster, hastier by design.
 *       Refinement (in-place): \`create-campaign\` regains ONE deliberate
 *       mid-flow checkpoint — after the campaign + lead form are built, Claire
 *       presents the budget and the Was/Now intro offer together and gets a
 *       single yes (budget + offer) before rendering any creative. The intro
 *       price is now read off the service (\`suggestIntroOffer\` parses
 *       \`priceText\`, tagged \`priceSource: 'parsed'\`) and presented for
 *       confirmation instead of always asking. Creatives are one offer video +
 *       TWO offer graphics (three draft ads). Budget tweaks at the checkpoint
 *       go through \`confirmUpdateBudget\`/\`executeUpdateBudget\`.
 *   v32: Duplication + single registry. The \`rollout-claire-build-with-defaults\`
 *       flag and the v30/v31 dual-registry are removed — there is now ONE
 *       registry (this one) for every conversation. \`manage-campaigns\` gains
 *       \`duplicateCampaign\` (copies a campaign + all its ads, paused, in the
 *       background), \`duplicateAd\` (Borradh ads → editable draft; imported ads
 *       → paused Meta copy) and \`listRecentAds\` (to find an ad to duplicate).
 *   (v32, additive) \`manage-messaging-campaigns\` skill (Messaging Campaigns
 *       Phase 7) — bulk SMS/email/WhatsApp campaigns to an audience segment,
 *       distinct from the Meta-ads \`manage-campaigns\`/\`create-campaign\` skills.
 *       Exposes \`campaigns_list\`, \`campaigns_segments_list\`, \`campaigns_create\`
 *       (draft, no confirm) and \`campaigns_launch\` (destructive — gated behind
 *       the \`launch_campaign\` confirmation action).
 *   v33: Messaging campaigns build out end-to-end in chat.
 *       \`manage-messaging-campaigns\` gains \`campaigns_setMessage\` (per-channel
 *       content incl. WhatsApp template + params), \`campaigns_previewAudience\`
 *       (live per-channel reach for a segment),
 *       \`campaigns_listWhatsappTemplates\` (approved templates from the linked
 *       WhatsApp Business account) and \`campaigns_showCampaignPreview\` (the
 *       interactive review card/modal embed rendered before launch). WhatsApp
 *       campaign sends are business-initiated via approved templates.
 *   v34: \`manage-messaging-campaigns\` gains \`campaigns_createSegment\` — Claire
 *       can save a reusable audience segment from filters (statuses, sources,
 *       tags, created window, last-contacted cutoff) and reports live reach,
 *       instead of sending the user to the Campaigns area to build one — and
 *       \`campaigns_checkChannels\`, making the flow channel-agnostic: Claire
 *       discovers what the org can deliver on (email always; SMS = number;
 *       WhatsApp = linked WABA) and builds with what's available instead of
 *       assuming. Skill classifier trigger widened to audience-segment asks.
 *   v35: \`create-ad\` and \`create-campaign\` gain \`listLibraryImages\` — Claire can
 *       browse the operator's OWN uploaded images and attach one directly as ad
 *       creative via the new \`assetId\` field on \`createDraftAd\` /
 *       \`replaceAdCreative\`, instead of being limited to AI-generated
 *       video/graphic creative. Closes the "use my own uploaded image as the
 *       ad" gap that was previously web-UI-only.
 *   v36: Bulk messaging is email-only. \`manage-messaging-campaigns\` drops
 *       \`campaigns_listWhatsappTemplates\` and its prompt no longer offers SMS
 *       or WhatsApp, matching the product: the composer now shows the email
 *       channel alone. Claire building on a hidden channel would produce a
 *       campaign the operator could not review or edit in the dashboard. The
 *       backend senders, webhooks and the \`campaign_channel\` enum are all
 *       untouched — restoring a channel means restoring the tool and wording
 *       here alongside \`ENABLED_CHANNELS\` in the frontend.
 *   v37: Phase 7 creative honesty. \`generate-graphic\` gains \`listOffers\` +
 *       \`createAdGraphic\` so an AD/offer graphic request is answered with the
 *       ad-graphic tool instead of the organic \`createGraphic\` relabelled
 *       "Ad 1"/"Ad 2" (#92). No-silent-substitution wording added across
 *       \`generate-graphic\`, \`create-ad\` and \`manage-campaigns\`: when the owner
 *       references their OWN upload, Claire passes their wording as \`assetRef\`
 *       (the tool resolves it or asks — never guesses an id, never substitutes
 *       an AI image; #37 #150 #151). \`manage-campaigns\` learns the honest
 *       \`requiresNewAd\` dead-end for a live-ad creative swap (duplicate → swap
 *       on the copy → launch). \`generate-video\` states video length is
 *       automatic and must not be promised as a specific cut (#213).
 *   v38: The clip list editor. \`generate-video\` swaps \`pickVideoClips\` for
 *       \`editVideoClips\` and states the line the four earlier attempts kept
 *       crossing: the CARD is for when the owner has NOT said what they want,
 *       and describing footage ("something with the treatment room") is a
 *       SEARCH Claire performs herself on either channel. After a card she
 *       says NOTHING — the card carries the fields and the Reject / Change
 *       Clips / Accept buttons, and Accept is what renders, so narrating it
 *       restates what the owner is looking at. The WhatsApp branch's quoted
 *       summary line was removed because it kept being copied onto WEB
 *       underneath that card. Added: never critique the footage — Claire has
 *       asset names, never frames, so "clip 3 doesn't belong here" is a guess
 *       delivered as an observation.
 *   v39: The PERSONA is what kept commenting under cards, not the skill. Its
 *       defaults-first rule said to surface every default "in one message and
 *       ask one question", which a card already does — so Claire wrote the
 *       message anyway, underneath the card, restating it. Block 1 now says
 *       that when a tool has put a card on screen the card IS that message and
 *       the reply is EMPTY. Fixing it in \`generate-video\` alone could not
 *       work: the persona outranks a skill and applies to every create flow.
 *   v40: Organic on-screen text. \`generate-video\` now carries the config key
 *       and text fields for every organic template, because Claire had no way
 *       to know them: asked to change a Caption Tease headline she patched
 *       \`scriptText\`, was told by the server that the template does not read
 *       it and to patch \`captionTease\` instead, retried the same patch, ran
 *       \`generateVideoScript\` (narration, which these templates do not have),
 *       tripped the circuit breaker and told the owner to email support about
 *       a supported edit. Added with it: a refused patch naming the right key
 *       is an instruction to follow, not a dead end.
 *   v41: A patch SAVES, the card RENDERS. \`patchDraftVideo\` defaulted to
 *       re-queueing, so a wording change spent a render immediately and showed
 *       nothing — the owner was told "re-rendering now" with no card, no
 *       artifact and no say in it, which is the exact bypass the approval card
 *       exists to close. It now returns the card prefilled and renders only on
 *       \`autoRender: true\`.
 *   v42: "The caption" is not the field called \`caption\`. On a Caption Tease
 *       both render: \`headline\` is the big serif line the owner is looking at,
 *       \`caption\` is a small cursive hook below it. Asked to "change the
 *       caption", Claire patched the field of that name, changed the hook, and
 *       reported success over a headline that had not moved. The table now says
 *       what each field IS, the rule is that an unqualified request means the
 *       MAIN line, and she names the field she changed so the owner can
 *       redirect instead of concluding the edit did nothing.
 *   v43: \`review-content\`. The bulk-review page is now the ordinary assistant
 *       chat — queue left, conversation middle, the post in the content panel
 *       right — so reviewing a post arrives here instead of through a bespoke
 *       server turn handler. Two new tools port what that handler could do:
 *       \`contentBatches_regenerateItem\` (confirmed; spends a render) and
 *       \`contentBatches_updateItemCaption\` (free). The DECISION stays out of
 *       chat: Save / Schedule / Reject are buttons in the panel, pressed by the
 *       person looking at the post.
 *   v44: \`review-content\` says plainly that Claire cannot read what a slide
 *       SAYS and does not need to: "change slide 2 / more salesy" is one
 *       \`regenerateItem\` call with \`slideIndex\` and \`reason\`. She had been
 *       asking three questions and then requesting the owner read their own
 *       screen aloud. The active-context line for a queued post now also names
 *       the asset behind the item, so the editing tools work from it the way
 *       they do in an ordinary chat.
 *   v45: Never invent a reason for a failure. A caption edit came back with an
 *       error and Claire reported the post as "locked on the platform side" and
 *       sent the owner to email Senan — about a pending post, in a batch, with
 *       a caption, that was perfectly editable. Added with it: the active
 *       context now LABELS its two ids, because "content item X … its graphic
 *       Y" invited passing Y to a tool that wanted X.
 *   v46: A queued VIDEO's on-screen copy now rides in the active-context line,
 *       numbered. Asked to "change item number 3" on a four-point video, Claire
 *       said she could not identify it — correctly, since nothing put the copy
 *       in front of her. An ordinary chat never had the problem because
 *       \`createDraftVideo\` returns \`textFrames\` into the transcript; the
 *       review page has no such turn. \`templateTextFields\` moved from
 *       \`content-batches\` to \`videos\` so the item layer can use it without a
 *       cycle.
 *   v47: Destructive confirmations RENDER now. The factory has always returned
 *       a \`confirmation_required\` presentation for every destructive tool and
 *       the app rendered none of it, so confirming happened in prose — and
 *       \`regenerateItem\` shipped with Claire announcing "confirm on the card
 *       above" over a card that did not exist. \`tool-renderer\` now dispatches
 *       on the ENVELOPE rather than the tool name, so every destructive tool
 *       gets the card, and the skill says to let it do the asking.
 *   v48: `review-content` relays instead of classifying. It carried a table
 *       mapping what an owner might say to one of four tools, plus the rules
 *       for building each payload — and every rule was a chance to pick wrong:
 *       "the caption" read as the on-screen text (free versus a render), a
 *       graphic sent down a text-patch path that cannot exist because its words
 *       are pixels, `{ numberedList: { items: [...] } }` authored from scratch
 *       to change one entry. All four tools collapse into `patchContent`, which
 *       takes the owner's words verbatim; the lever is chosen server-side by
 *       `handleReviewTurn`, which holds the item's kind, its template fields
 *       and its clip list. Deliberately no `change` override — a second path is
 *       a path that drifts.
 *   v49: One create, one edit. `createDraftVideo`, `createGraphic` and
 *       `createAdGraphic` become `createContent({ kind })`; the three were
 *       split by ASSET KIND, which is not what an owner chooses between, and
 *       only one of them opened a content item — so a graphic could be edited
 *       afterwards and an ad creative could not be edited at all. An offer on a
 *       graphic is what makes it a paid ad, replacing the separate tool. With
 *       v48's `patchContent` this leaves two content tools where there were
 *       eight.
 *   v50: The videos area, cut from 16 tools to 8. `queueVideoExport` +
 *       `executeVideoExport` collapse into one destructive `renderVideo` —
 *       the split existed because "the current frontend doesn't support
 *       re-invocation", which stopped being true when every confirmation
 *       started answering by message. `updateDraftConfig` is gone: it edited a
 *       draft by VIDEO id, which is the wrong handle once an edit forks the
 *       video. `listAvailableAssets` + `listStockClips` become
 *       `listMedia({ source })` — the same question asked of two shelves, and
 *       splitting it produced "you'd need to upload footage first" for orgs
 *       whose videos were already built from stock.
 *
 *       `renderVideo` stays separate from `patchContent` on purpose:
 *       confirmation is declared per TOOL, so one tool doing both would have to
 *       confirm every caption change or spend a render without asking.
 *   v51: Organic videos ROTATE. "Make me an organic microneedling video" came
 *       back as the same template every time — nothing was random, the format
 *       was picked by the model from an enum and a model picks consistently.
 *       Graphics have rotated by per-org offset since the batch planner, on the
 *       reasoning that a fresh random draw "frequently lands on the same
 *       layouts" and owners read that as "it looks like last month" even when
 *       the copy is new. Videos never got it. `createContent` now takes
 *       `usage: 'organic'` and leaves `format` EMPTY unless the owner named a
 *       style; the server walks `ORGANIC_TEMPLATE_IDS` from a count of what the
 *       org has already made. A named format still wins.
 */
export const SKILL_REGISTRY_VERSION = 51;

/**
 * Skill registry.
 *
 * Order matters: `default` first so it's always available; single-feature
 * skills next; cross-feature composite skills last so the registry reads
 * top-down from primitives to compositions.
 */
export const skills: SkillModule[] = [
  defaultSkill,
  createCampaignSkill,
  manageCampaignsSkill,
  manageMessagingCampaignsSkill,
  createAdSkill,
  optimiseAdsSkill,
  pauseAdSkill,
  updateBudgetSkill,
  schedulePostSkill,
  generateVideoSkill,
  generateGraphicSkill,
  reviewContentSkill,
  manageLeadsSkill,
  manageLeadFormsSkill,
  manageServicesSkill,
  manageAppointmentsSkill,
  manageOffersSkill,
  manageCustomerChatsSkill,
  manageDefaultsSkill,
  createOfferAndPromoteV1Skill,
  weeklyMarketingReviewSkill,
  respondToLowCplSkill,
];

const skillsById = new Map<string, SkillModule>(skills.map((s) => [s.id, s]));

export function getSkillById(id: string): SkillModule | undefined {
  return skillsById.get(id);
}

/**
 * Build the deduped union of tool names across the loaded skills. Used by
 * the controller to construct the active tool set for a turn.
 *
 * Unknown skill IDs are silently dropped; the orchestrator's classifier
 * has a `['default']` fallback so a missing ID can't strand a conversation.
 */
export function buildToolListForSkills(skillIds: string[]): string[] {
  return buildToolListForSkillsFrom(skillsById, skillIds);
}

function buildToolListForSkillsFrom(
  byId: ReadonlyMap<string, SkillModule>,
  skillIds: string[]
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of skillIds) {
    const skill = byId.get(id);
    if (!skill) continue;
    for (const name of skill.toolNames) {
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * A resolved skill registry: a version stamp + the skill array and lookup
 * helpers. There is a single registry — the fewer-steps (build-with-defaults)
 * content — used by every conversation.
 */
export interface ResolvedSkillRegistry {
  version: number;
  skills: SkillModule[];
  getSkillById: (id: string) => SkillModule | undefined;
  buildToolListForSkills: (skillIds: string[]) => string[];
}

/** The single skill registry used for every conversation. */
export const skillRegistry: ResolvedSkillRegistry = {
  version: SKILL_REGISTRY_VERSION,
  skills,
  getSkillById,
  buildToolListForSkills,
};

export type { SkillId, SkillModule } from './types.js';
export {
  buildBusinessContextBlock,
  buildOrchestratorPrompt,
  buildPersonaBlock,
  buildSkillFragmentsBlock,
  buildSkillIndexBlock,
  type AnthropicSystemBlock,
  type OrchestratorPrompt,
  type OrchestratorOverrides,
} from './orchestrator.js';
export { defaultSkill } from './default.skill.js';
export { createCampaignSkill } from './create-campaign.skill.js';
export { createAdSkill } from './create-ad.skill.js';
export { optimiseAdsSkill } from './optimise-ads.skill.js';
export { pauseAdSkill } from './pause-ad.skill.js';
export { updateBudgetSkill } from './update-budget.skill.js';
export { schedulePostSkill } from './schedule-post.skill.js';
export { generateVideoSkill } from './generate-video.skill.js';
export { generateGraphicSkill } from './generate-graphic.skill.js';
export { reviewContentSkill } from './review-content.skill.js';
export { manageCampaignsSkill } from './manage-campaigns.skill.js';
export { manageMessagingCampaignsSkill } from './manage-messaging-campaigns.skill.js';
export { manageLeadsSkill } from './manage-leads.skill.js';
export { manageAppointmentsSkill } from './manage-appointments.skill.js';
export { manageOffersSkill } from './manage-offers.skill.js';
export { manageServicesSkill } from './manage-services.skill.js';
export { manageCustomerChatsSkill } from './manage-customer-chats.skill.js';
export { manageDefaultsSkill } from './manage-defaults.skill.js';
export { createOfferAndPromoteV1Skill } from './create-offer-and-promote-v1.skill.js';
export { weeklyMarketingReviewSkill } from './weekly-marketing-review.skill.js';
export { respondToLowCplSkill } from './respond-to-low-cpl.skill.js';
