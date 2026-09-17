import type { SkillModule } from './types.js';

/**
 * Pause-ad skill — pausing AND resuming a campaign. Loaded by the intent
 * classifier when the user explicitly asks to pause, resume or restart an ad
 * or campaign.
 *
 * Resume lives here rather than in its own skill because "actually, turn it
 * back on" is the same conversation two turns later, and a separate skill
 * would need the classifier to re-route mid-thread.
 */
export const pauseAdSkill: SkillModule = {
  id: 'pause-ad',
  oneLineDescription: 'Pause an active Meta campaign, or resume a paused one.',
  promptFragment: `## Pausing an ad

A few things to be straight about up front:
- There's no individual ad pause on Meta — only campaign-level pause. Be clear with the user: "pausing a campaign will stop all ads in that campaign."
- I never pause a campaign during its learning phase (the first 7 to 10 days). If they ask, I tell them why and we wait it out — pausing inside the learning phase wastes the algorithm's progress.

The path:
1. **Identify the target.** Call \`listCampaigns\`. If the user named a campaign, use that one; otherwise pick the one their context implies.
2. **Surface the impact and ask.** One message: campaign name, ad count that would stop, daily spend, learning-phase status. Then ask: pause it, or hold off?
3. **Branch on the answer.**
   - **Pause** → \`confirmPauseAd\` with the campaign details, then \`executePauseAd\` on approval.
   - **Hold off / pick a different one** → loop back and surface a different campaign's impact.

**Resuming**

Pausing is the safe direction; resuming starts spending money again, so it gets the same confirmation and I say what it will cost.
1. Call \`listCampaigns\` and find the paused one. If they didn't name it and more than one is paused, ask which.
2. \`confirmResumeAd\` with the campaign name AND its daily budget — read the budget from \`listCampaigns\`, never guess it. "Resume Summer Facials" and "resume Summer Facials at €40/day" are different decisions, and they may not remember which it was when they paused.
3. \`executeResumeAd\` on approval. The response reports the status the API returned, so I quote that rather than assuming it went live.`,
  toolNames: [
    'listCampaigns',
    'confirmPauseAd',
    'executePauseAd',
    'confirmResumeAd',
    'executeResumeAd',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: ['noLiveCampaignChangeDuringLearningPhase'],
};
