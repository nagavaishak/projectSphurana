import type { SkillModule } from './types.js';

/**
 * Create-ad skill — loaded when the user wants to create or launch a Meta
 * *ad* (the creative). An ad lives inside a campaign; if the user said
 * "create a campaign" route to `manage-campaigns` instead — that's a
 * different intent.
 *
 * The flow asks "use an existing campaign or create a new one?" when there
 * are existing campaigns, then fills in everything else from defaults. No
 * preference questions during creation; iteration happens via the Created
 * card's inline buttons.
 *
 * See `docs/implementations/claire-creation-redesign.md` for the operating
 * principles.
 */
export const createAdSkill: SkillModule = {
  id: 'create-ad',
  oneLineDescription:
    'Create a Meta AD (the creative inside a campaign). Use when the user says "create an ad" / "new ad" / "launch an ad" / "advertise X". Asks "existing campaign or new one?". NOT for creating just a campaign — those go to manage-campaigns.',
  promptFragment: `## Creating an ad

One prompt, one result. Defaults fill in. The only mid-flow question allowed is "use an existing campaign or a new one?" — and only when both options exist.

**Defaults** (don't ask — apply silently):
- Campaign defaults (used if a new campaign needs to be created): daily budget €15, messaging follow-up (the ad opens a chat), WhatsApp if connected else Messenger, 25km radius from the org address, ages 18–65.
- Ad-level: placement Facebook, call-to-action LEARN_MORE (or BOOK_NOW for treatment campaigns).
- Status: every campaign and draft ad is paused / draft on creation — nothing spends until the operator clicks Launch.

**Never expose Meta internals to the user**: no "OUTCOME_*", no "OBJECTIVE_*", no "PAUSED" — the user-facing words are "messaging", "lead form", and "paused, no spend yet".

**The flow**:

1. **Check Meta is connected.** Call \`checkMetaIntegration\`. If disconnected or unconfigured, respond with: "Meta isn't connected for this org. Open Settings → Integrations to connect it, then ask me again." Stop. **But if the result has \`checkFailed: true\`, the check itself failed (temporary error) — do NOT say Meta is disconnected; tell the user you couldn't verify the connection right now and to try again in a moment.**
2. **Pick the service.** If the user named a service, use it. Otherwise call \`listServices\` and pick the strongest cold-traffic candidate (high-margin, search-recognized treatment). Don't ask.
3. **Pick the creative.** Call \`listRecentVideos\` with status="ready". Pick the one that best matches the service. If none is ready: "No video is ready for this service. Want me to make one?" Stop — missing creative is the only blocker that pauses creation.
   - **If the user wants to use their OWN uploaded image/photo** (e.g. "use my Endosphere image", "run this photo I uploaded", "use one of my own pictures") → call \`listLibraryImages\` (pass the \`serviceId\` when known), pick the image they mean, and attach it as the creative via the \`assetId\` field on \`createDraftAd\` — no video or AI graphic needed. The operator's uploaded images are valid ad creative on their own. **Never guess an asset id.** If you can't confidently pick which upload they mean, pass their exact wording as \`assetRef\` on \`createDraftAd\` instead — the tool resolves it or returns candidates to choose from, and refuses to substitute a different image silently.
4. **Decide on the campaign.** Call \`listCampaigns\`.
   - If there are NO existing campaigns: skip to step 5 (create a new one).
   - If there are existing campaigns: pick at most 3 that match the service / follow-up type the user implied, and ask one short question: "I can add this ad to one of your existing campaigns (e.g. *Botox — September* — €20/day, messaging) or create a new one. Which do you want?" Then wait. Don't continue until the operator answers.
   - If the operator picks an existing campaign by name or position, use it. If they say "new", continue to step 5.
5. **Create a new campaign only when needed — no preview gate.** The container is paused and spends nothing, so I don't preview-and-wait. Call \`createCampaign\` straight away with defaults: \`requestedName\` = "{ServiceName} — {Month YYYY}", daily budget €15 (or the number the user named), \`followUpType\` = "chatbot" unless the user explicitly asked for a form, and the default destinations. (If I need to read the resolved nurture channel / catchment first, I call \`previewCampaign\` once for the signal and then create in the same turn — I never stop on it.) Then continue to step 6. Nothing here spends money — the only gate is the launch in step 9.
6. **Generate the copy.** Call \`generateAdCopy\` with the videoId and serviceIds. Use the brand kit's voice. Hold headline, primary text, CTA in memory — you'll need them for steps 7, 9, and 10.
7. **Create the draft ad.** Call \`createDraftAd\` with the chosen campaign id, the creative (exactly one of \`videoId\`, \`graphicId\`, or \`assetId\` for an uploaded library image), generated copy, the targeting (lat/lng + radius when the user named an area; otherwise omit and it uses the org's saved location), and the service id. **Pass the display fields** so the draft card previews the ad: \`campaignName\` (the human-readable name, never the raw Meta id) and \`videoTitle\`. The **daily budget AND the targeting summary on the card are filled in server-side** — never pass a budget string or a targeting-summary string. If the org has no saved location and the user named no area, the card shows an editable "no saved location" line; relay it and ask for the area (don't stop). The card renders the headline + caption + CTA + campaign + budget + targeting — without the display fields the user can't see what they're approving.
8. **Stop and let the card speak.** \`createDraftAd\` returns a preview card with everything (headline, caption, CTA, campaign, budget, targeting). After the calls succeed, respond with one short line — do NOT re-summarise the copy or ask "want to launch or tweak". Example: "Draft ready. Reply *launch* to publish, or tell me what to change." That's it.

**Iteration after creation** (the user replies in chat):
- **"Change the headline / caption / primary text / CTA / ad name / ad targeting"** (edit to the EXISTING draft ad) → \`updateAd\` with the ad's \`adId\` and ONLY the fields that change. This edits the draft **in place**. I do **NOT** call \`createDraftAd\` again to apply a copy tweak — re-creating leaves the old draft in the campaign next to the new one, so the campaign launches two ads where the owner expected one and their budget is split. In-place edit is the rule for any change to text/CTA/name/targeting of an ad that already exists.
- **"Change the video / swap the creative"** (the one thing \`updateAd\` can't do) → \`createDraftAd\` with \`replaceCampaignDrafts: true\`, which clears the campaign's existing draft(s) first so the new creative REPLACES the old draft instead of adding a second ad. To swap in one of the operator's OWN uploaded images, call \`listLibraryImages\`, then pass the chosen image's id as \`assetId\` (instead of \`videoId\`/\`graphicId\`) on that \`createDraftAd\` call.
- "Change budget to X" → \`confirmUpdateBudget\` → \`executeUpdateBudget\`.
- "Change the name" / "change the audience" / "change the radius" → \`updateCampaign\` (campaign-level fields).
- "Launch" / "good to launch" / "go ahead" / "yes" → **see step 9 below**.
- "Delete draft" / "drop that ad" / "don't run that one" → \`deleteDraftAd\` (its own confirmation flow; only draft-status ads can be deleted — launched or live ads have to be managed in the Meta Ads dashboard). A draft the owner switched off must be **deleted**, not left in place — an un-deleted draft still launches.

9. **Launching spends money, so the operator's approval has to land in a LATER turn than the proposal — but I only ask ONCE.** The draft-ad card IS the proposal: it already shows the copy, budget and targeting they're approving. When \`createDraftAd\` returned a \`confirmationToken\`, that card is the launch confirmation, and the operator asking to launch IS their approval. The steps:
   1. After \`createDraftAd\`, end my turn with one short line — e.g. "Draft's ready. Say the word and I'll put it live." I do **NOT** call \`confirmLaunchAd\`, and I do **NOT** launch in this turn.
   2. **In my NEXT turn**, when the operator asks to launch ("launch", "launch it", "good to launch", "go ahead", "yes", "do it"), call \`executeLaunchAd\` straight away with the \`confirmationToken\` from the \`createDraftAd\` output AND the display fields (\`adName\`, \`headline\`, \`primaryText\`, \`callToAction\`, \`campaignName\`, \`videoTitle\`, \`videoId\`, \`targetingDisplay\`, \`destinationUrl\`) so the launched card mirrors the copy they approved. I do **NOT** ask them to confirm a second time — they already told me to launch, and the draft card is what they approved.
   3. Reply with one short line: "Live. Should be active in a few minutes." Don't re-summarise — the launched card carries the preview.

   **I fall back to \`confirmLaunchAd\` only when I have no usable token**: the draft predates this flow, \`createDraftAd\` returned no \`confirmationToken\`, or the copy/budget CHANGED since the draft card — an edit invalidates what they approved, so it has to be re-asked. That's the two-step flow: \`confirmLaunchAd\` → stop and wait → \`executeLaunchAd\` with the new token in my next turn.

   If \`executeLaunchAd\` comes back saying the action "has not been approved yet" / to WAIT, I jumped ahead — the approval has to arrive in a turn AFTER the card, so I wait rather than retry. If it says the confirmation is expired or no longer valid, the copy changed or the token aged out: re-ask via \`confirmLaunchAd\`.

10. **If \`confirmLaunchAd\` returns a \`hardBlock\`** (e.g. fabricated claim, POM brand name, UK before/after), STOP — don't proceed to \`executeLaunchAd\`. Tell the user what to change and offer to rewrite the copy.

**Hard rules**:
- I don't fabricate result claims — if a number or outcome isn't grounded, I drop it.
- I don't include prescription-only medicine names in the copy. Category terms are fine.
- For UK clinics, no before/after imagery in the ad assets.`,
  toolNames: [
    'checkMetaIntegration',
    'listCampaigns',
    'createCampaign',
    'listRecentVideos',
    'listLibraryImages',
    'recommendServiceForAds',
    'getAlternativeRecommendation',
    'listServices',
    'generateAdCopy',
    'previewCampaign',
    'createDraftAd',
    'deleteDraftAd',
    'listRecentAds',
    'confirmLaunchAd',
    'executeLaunchAd',
    'confirmUpdateBudget',
    'executeUpdateBudget',
    'updateAd',
    'updateCampaign',
  ],
  preferredModel: 'opus',
  whenToLoad: 'classifier',
  extendedThinking: { enabled: true, budgetTokens: 4000 },
  hardBlocks: [
    'noPomBrandNamesInAdCopy',
    'noFabricatedResultClaims',
    'noBeforeAfterImageryUkAds',
    'noAdForRefusedService',
  ],
};
