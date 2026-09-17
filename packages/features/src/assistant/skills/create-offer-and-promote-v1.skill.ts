import type { SkillModule } from './types.js';

/**
 * Composite skill — create-offer-and-promote-v1.
 *
 * The first cross-feature workflow skill (Track C-15). Orchestrates three
 * existing single-feature skills via the `meta_loadSkill` meta-tool:
 *   1. `manage-offers` — gather offer details, run `createOffer`.
 *   2. `generate-video` — draft a promo video for the offer.
 *   3. `schedule-post` — schedule the social post.
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
 * v2 of this workflow (`create-offer-and-promote-v2`) adds a graphics step
 * between offer-create and post-schedule and lands in Phase 6 alongside
 * Track C-20.
 */
export const createOfferAndPromoteV1Skill: SkillModule = {
  id: 'create-offer-and-promote-v1',
  oneLineDescription:
    'Create an offer and roll it out — generate a promo video and schedule the social post.',
  promptFragment: `## Create an offer and promote it

The defaults do the work across all three sub-skills. Don't run three wizards back-to-back. The path:

1. **Pick defaults across the whole rollout silently.** Before asking the user anything, work out the full plan:
   - **Offer** — service, discount type + amount, validity window, name, code, locations. Use \`load_skill('manage-offers')\` to access offer tools; pick the strongest service for a discount-led offer (the recommendation engine can score this if it's available).
   - **Promo video** — template that pairs with offer-promo (typically an offer-template or before/after with an offer overlay), service from step above, script built around the discount + validity, clips, music, captions on default.
   - **Social post** — all connected platforms, video as the asset, generated caption that pulls the discount and validity into the hook, top suggested posting time.
2. **Surface the whole rollout and ask.** One message that covers all three: the offer (service, discount, validity, code, locations), the video (template, script angle, music/captions on defaults), the post (platforms, caption, scheduled time). Then ask one question: roll it all out with these defaults, or change a setting first?
3. **Branch on the answer.**
   - **Roll it out with defaults** → run the three confirmations in order: \`load_skill('manage-offers')\` → \`createOffer\` (with the operator's already-given green light), then \`load_skill('generate-video')\` → draft + queue export, then \`load_skill('schedule-post')\` → \`createSocialPostDraft\` → \`schedulePost\`. Each sub-skill's own confirmation token still fires; don't re-ask the high-level "do you want to do this?" question.
   - **Change a setting** → ask which (or take the specific change they named), adjust only that piece, re-surface the updated summary across all three, ask again.
   - **Reject entirely** → ask what direction they had in mind, re-derive defaults, surface again.
4. **Tell the user clearly what's done, what's queued, and what's scheduled.** If the video render takes a while (it usually does), say so — don't let them think the post is already live when the video isn't ready yet.

This is a multi-skill flow. Each sub-skill's destructive confirmations still fire — that's at the tool level, not the high-level plan. If the user wants to short-circuit (e.g. skip the video and post the offer separately), follow their lead — partial completion is fine.

v2 of this workflow includes a graphics step. That's coming later (Phase 6). For now, video is the only generative asset.`,
  toolNames: [],
  preferredModel: 'opus',
  whenToLoad: 'classifier',
  extendedThinking: { enabled: true, budgetTokens: 4000 },
  hardBlocks: [],
};
