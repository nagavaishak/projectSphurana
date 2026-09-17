import type { SkillModule } from './types.js';

/**
 * Composite skill — respond-to-low-cpl (Track C-15, Phase 4).
 *
 * Loaded by the intent classifier when the operator says "my CPL is up", "my
 * ads aren't working", "ads are getting expensive", or similar performance
 * complaints. The skill walks a diagnose-first path: pull the data via
 * `optimise-ads`'s `suggestAdOptimizations`, decide which campaign deserves
 * action, then load the right narrow skill (`pause-ad` or `update-budget`)
 * — or `generate-video` for a creative refresh — and confirm before acting.
 *
 * Architectural note: this skill carries no tool fan-out of its own. Its
 * `toolNames` is empty — the controller always loads the meta tools
 * (`meta_loadSkill`, `meta_dispatchTour`) regardless of skill state, so
 * declaring them here would be redundant and would also fail the registry
 * test that maps every declared toolName back to a known tool. The child
 * skills' tools are pulled in dynamically by `meta_loadSkill` so the
 * composite skill stays small and the per-turn prompt only carries the
 * fragments the conversation needs.
 *
 * Hard blocks are deliberately empty here: the underlying tools enforce
 * `noLiveCampaignChangeDuringLearningPhase` and `noScalingBeforeLearningExits`
 * via the factory layer (W-C05). The prompt below reinforces them at the
 * model layer as defence-in-depth, but the validators are the source of
 * truth.
 */
export const respondToLowCplSkill: SkillModule = {
  id: 'respond-to-low-cpl',
  oneLineDescription:
    'Diagnose poor ad performance and act — pause, scale, or refresh creative.',
  promptFragment: `## Responding to low ad performance

When the user says "my CPL is up", "my ads aren't working", "Facebook's getting expensive", "I've had zero bookings", or similar — here's the path.

### Always diagnose with data before responding

When an owner reports a campaign isn't working — especially an emotional "zero bookings" complaint — check the actual data first. Call \`load_skill('optimise-ads')\`, then \`diagnoseCampaign\` on the campaign in question. It returns, computed for you: whether the campaign has spent enough to judge (the €80 gate), how many high-intent leads it has produced and how many days since the last one, the service tier, the budget band, and how many troubleshooting rounds have already been tried. Open with what the data says, not "let me check" — be assertive and lead with the numbers, not sympathy.

### Step 1 — Has it spent enough? (€80 gate)

If \`spentEnough\` is false, the campaign hasn't had a fair test. Meta needs roughly €80 of spend before the data means anything. Tell the owner plainly: it's too early to call it — hold steady until it clears €80, then we judge it properly. Don't change anything yet.

### Step 2 — Are there high-intent leads?

Once it's past €80, read \`highIntentLeadCount\`:

**3A — Leads exist but aren't booking** (\`highIntentLeadCount\` > 0): the ad is working; the gap is downstream. Walk the three usual causes: a price objection (the offer may be above what this audience expects), booking friction (the path from chat to booked is too long), or response time (leads cool fast — speed-to-lead is the differentiator). Use \`getCampaignInsights\` and the conversation data to point at which one. Fix the funnel, not the ad.

**3B — No high-intent leads** (\`highIntentLeadCount\` === 0 after €80): branch by \`serviceTier\`:
   - **Tier 1** (price-visible intro): the offer is the lever. The intro price is probably too high or the creative isn't selling it. Adjust the offer first (see lifecycle below).
   - **Tier 2** (switch-service): the service being advertised may be the wrong lead-in. Consider switching to the rank-2 service the org should lead with.
   - **Tier 3** (consultation-led / surgical): cold-traffic conversions are rare here by design. Reset expectations — these campaigns sell the consultation, and retargeting carries more of the load.

### Lifecycle — one round at a time, then escalate

Read \`roundsTried\` and \`escalated\` from the diagnosis and move through the loop in order:
   - **Round 1 — offer adjustment.** Lower the intro PRICE, not a percentage — a concrete lower number reads as a real offer. Same service, same creative. Then let it run.
   - **Round 2 — creative refresh.** Same offer, new creative. Call \`load_skill('generate-video')\` to make a fresh asset.
   - **After 2 rounds with no improvement — escalate to a human.** Hand off to Senan or Louis with the campaign ID, the service, the offers already tried, the spend, and the lead data. Don't loop a third time.
   If a campaign is already \`escalated\`, say so and don't restart the loop.

### Budget bands (the owner always decides budget)

Read \`budgetBand\`:
   - **below_10** (under €10/day): warn — that's likely too thin for Meta to optimise well. Suggest €20/day if they can.
   - **10_to_19**: acceptable. Workable, not ideal.
   - **20_plus**: recommended range. Good.
   Frame budget as the owner's call — surface the band and the reasoning, then let them decide. Never push a budget change as the default fix.

### The ROI reframe

When an owner balks at the intro offer's margin, reframe it: the intro offer is a customer-acquisition cost, not a profit line. The first appointment is what buys a returning client. Run the lifetime-value lens, not the single-transaction one.

### "It's cheaper elsewhere"

If they say another agency or boosting is cheaper, the answer is speed and the booked outcome — fast, qualified, conversation-led leads that turn into appointments beat raw cheap clicks. The differentiator is speed-to-lead and the booking pipeline, not the click price.

### Acting on the diagnosis

When the owner approves an action, route via the right narrow skill:
   - **Pause:** \`load_skill('pause-ad')\` → \`confirmPauseAd\` → \`executePauseAd\` on approval.
   - **Budget change:** \`load_skill('update-budget')\` → \`confirmUpdateBudget\` → \`executeUpdateBudget\`; recommend +20%, not more — Meta gets jittery on big jumps.
   - **New creative:** \`load_skill('generate-video')\`.

Hard rules that hold no matter how the owner pushes:
   - Never change a live campaign during Meta's learning phase. If it's still learning (under 7–10 days), say so and wait — the tool layer blocks it anyway.
   - Never scale before the learning phase exits.
   - One campaign at a time; respect every confirmation card.

Don't reach for "more budget" as the reflex fix. Diagnose first; every change comes from the data, not from impulse.`,
  toolNames: [],
  preferredModel: 'opus',
  whenToLoad: 'classifier',
  extendedThinking: { enabled: true, budgetTokens: 4000 },
  hardBlocks: [],
};
