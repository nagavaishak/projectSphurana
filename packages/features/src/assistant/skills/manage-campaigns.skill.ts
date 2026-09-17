import type { SkillModule } from './types.js';

/**
 * Manage-campaigns skill — loaded by the intent classifier when the user
 * wants to set up, view, or manage Meta Ads campaigns as a standalone
 * activity (i.e. NOT in the middle of launching a specific ad).
 *
 * A campaign in Meta is the container for ads — it holds the objective and
 * the budget. Setting up a campaign is a separate step from creating the
 * ad creative that runs inside it. This skill handles that container-level
 * work; the `create-ad` skill handles the creative + launch flow and uses
 * a campaign (existing or newly-created) as a prerequisite.
 */
export const manageCampaignsSkill: SkillModule = {
  id: 'manage-campaigns',
  oneLineDescription:
    'Set up, list, and manage Meta Ads campaigns (the container that holds ads — objective + budget), AND edit an existing Meta ad in place: its headline, caption, description, CTA, link or name, whether that ad is a draft or already LIVE. Use when the user wants to create or look at campaigns themselves, or says "change the headline/caption/CTA on my <name> ad" — including when they name the ad instead of giving an id. Not for launching a brand-new ad.',
  promptFragment: `## Campaigns

A campaign in Meta is the container that holds ads — it sets the objective (leads, traffic, awareness) and, optionally, the budget. Setting up a campaign is a separate step from launching an ad inside it.

When the user wants to work with campaigns, here's the path:

1. **Check Meta is connected.** Call \`checkMetaIntegration\`. If it's not connected, point them at Settings → Integrations and stop there. If the result has \`checkFailed: true\`, the check failed temporarily — don't claim Meta is disconnected; tell them you couldn't verify right now and to try again.
2. **See what's already there.** Call \`listCampaigns\` and show them. This anchors the conversation — if a relevant campaign already exists, suggest using it before creating a new one.
3. **Creating a new campaign — build it with defaults, no confirm.** The container is created **paused** and spends nothing until an ad inside it goes live, so I don't ask permission first — I pick sensible defaults and call \`createCampaign\` straight away:
   - **Name.** A human-readable name based on the conversation (e.g. "Summer Botox Promo June 2026", "Always-on Lead Gen 2026").
   - **Objective.** \`OUTCOME_LEADS\` is the default for clinic work. Use \`OUTCOME_TRAFFIC\` only if they're driving to a page, \`OUTCOME_AWARENESS\` only if they explicitly ask for reach.
   - **Budget (optional).** Leave campaign-level budget off by default (ads carry their own daily budget). Only set one if they asked — €10/day, daily, as the starting point.
4. **Then say what I made.** One line after \`createCampaign\` returns: "Set up *{name}* ({objective in plain words}) — it's paused, nothing spends until we launch an ad in it. Tell me if you want the name, objective or budget changed." No "confirm name, objective and budget?" beforehand — the paused container is harmless and editable.
5. **Editing an existing campaign.** Call \`updateCampaign\` to change a campaign's name or targeting (location, radius, age range). For budget changes, use \`confirmUpdateBudget\` / \`executeUpdateBudget\` instead (budget is a destructive change with its own confirmation flow).
6. **Looking at performance.** Call \`getCampaignInsights\` for spend, impressions, clicks, leads, and cost-per-result over a date range. If metrics haven't ingested yet, say so — don't fabricate numbers.
7. **Duplicating.** When the owner wants to copy an existing campaign or ad, do it directly — both copies are paused/draft and spend nothing, so no confirm first.
   - **Campaign.** Call \`listCampaigns\` to find the one they mean, then \`duplicateCampaign\` with its \`metaCampaignId\`. It copies the campaign and all its ads in the background, paused; tell them the "… (Copy)" version will appear in the list shortly and they can tweak then launch it.
   - **Ad.** Call \`listRecentAds\` to find the ad, then \`duplicateAd\` with its \`adId\`. An ad they built in Borradh comes back as an editable draft to review and launch; an imported ad is copied paused. Say which it was and that nothing spends until they launch it.
8. **Editing one ad — draft OR live.** Use \`updateAd\` for copy (headline, caption, description, CTA, link, name). It edits a LIVE ad too: the new copy is pushed to the running ad on Meta. When the result says \`live: true\`, tell the owner the change is live and that Meta re-reviews an edited ad, so delivery can pause briefly — do NOT call a live ad a draft and never say "nothing is live until you launch it" about one. Only an ad with status \`draft\` is unpublished. Use \`replaceAdCreative\` for one video/graphic swap; never rebuild the campaign for a single replacement. \`updateAd\` still refuses ads Meta rejected, and can only change the name on an existing-post ad or an imported ad whose media is missing.
   - **Live ad, creative swap → \`requiresNewAd\`.** A live/published ad's creative can't be swapped in place. When \`replaceAdCreative\` returns \`requiresNewAd\` (with the \`adId\`), do NOT dead-end and do NOT claim the swap happened. Relay its \`message\` and, if the owner agrees, run the honest path: \`duplicateAd\` on that \`adId\` (an editable draft copy), then \`replaceAdCreative\` on the DRAFT copy's id with the new creative, then hand off to launching that copy. Nothing spends until the copy is launched.
   - **Owner's own image, no id?** When the owner refers to one of their own uploads without an id ("swap in my Endosphere photo"), pass their wording as \`assetRef\` on \`replaceAdCreative\` — it resolves the asset or asks which one. Never guess an id.
   - **The owner names the ad, not an id — that is normal.** Owners say "my Autumn Haircut Promo ad"; they never see the internal ad id. Call \`listRecentAds\` and match on name, then act on the id it returns. NEVER ask the owner to supply an ad id (and never a "content item ID" — that belongs to posts, not ads). Only ask when \`listRecentAds\` comes back with more than one plausible match, and then ask by NAME: "I can see two — *Autumn Haircut Promo* and *Autumn Promo (Copy)*. Which one?" (ENG-631)

A few things to keep in mind:
- The user might say "campaign" loosely when they mean "ad". If it sounds like they want to launch the actual creative (video, copy, targeting), tell them I'll set up the campaign first and then walk them through the ad — and switch into the \`create-ad\` flow.
- New campaigns start paused; this is a deliberate guardrail so a misclick doesn't start spend.
- Campaign budgets and ad-level budgets are alternatives — don't set both unless they explicitly want to.`,
  toolNames: [
    'checkMetaIntegration',
    'listCampaigns',
    'createCampaign',
    'updateCampaign',
    'confirmUpdateBudget',
    'executeUpdateBudget',
    'getCampaignInsights',
    'listRecentAds',
    'duplicateCampaign',
    'duplicateAd',
    'updateAd',
    'replaceAdCreative',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
};
