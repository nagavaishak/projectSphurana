import type { SkillModule } from './types.js';

/**
 * Optimise-ads skill — broad ad management and optimisation guidance.
 * Loaded when the user asks to "optimise my ads", "review ad performance",
 * or similar. Uses Opus for the analytical reasoning across many ads.
 */
export const optimiseAdsSkill: SkillModule = {
  id: 'optimise-ads',
  oneLineDescription:
    'Review ad performance and recommend pauses, budget changes, and creative refreshes.',
  promptFragment: `## Reviewing and optimising ads

When the user asks to "optimise my ads" or wants a performance review, here's the path:

1. **Pull the picture.** Call \`suggestAdOptimizations\` to analyse all active campaigns and ads.
2. **Show the performance.** Lay out a clear summary with per-ad metrics — spend, leads, CTR, CPL.
3. **Walk through the recommendations.** For each one, give the reason and the action — pause, increase budget, create new creative, adjust targeting.
4. **Execute on approval.** When the user wants to act on a recommendation:
   - **Pause:** Call \`confirmPauseAd\` first — explain it pauses the whole campaign — then \`executePauseAd\` on approval.
   - **Budget change:** Call \`confirmUpdateBudget\` with current and new amounts, then \`executeUpdateBudget\` on approval.
   - **New creative:** Offer to create a new video and set up a new ad.
5. **Use what you know.** Pull from the knowledge base — past ad performance, CTA effectiveness, template performance — to enrich what you recommend. For example, "your before-after videos typically outperform offer videos."

Reminders:
- I never change a live campaign during Meta's learning phase. The first 7 to 10 days are off-limits — if a campaign's still in learning, I tell them so and we wait.
- I never recommend scaling before the learning phase exits. "More budget" on a learning campaign is a no.
- Broad targeting wins on small budgets — Facebook's algorithm is good at finding the right audience. I recommend starting broad and only narrowing when there's a specific reason.
- When suggesting budgets, the reasoning is grounded in area and service type, not pulled from thin air.`,
  toolNames: [
    'checkMetaIntegration',
    'listCampaigns',
    'listRecentAds',
    'getAdInsights',
    'getCampaignInsights',
    'suggestAdOptimizations',
    'diagnoseCampaign',
    'confirmPauseAd',
    'executePauseAd',
    'confirmUpdateBudget',
    'executeUpdateBudget',
  ],
  preferredModel: 'opus',
  whenToLoad: 'classifier',
  extendedThinking: { enabled: true, budgetTokens: 4000 },
  hardBlocks: [
    'noLiveCampaignChangeDuringLearningPhase',
    'noScalingBeforeLearningExits',
  ],
};
