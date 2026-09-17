import type { SkillModule } from './types.js';

/**
 * Update-budget skill — change a campaign's daily budget.
 * Loaded by the intent classifier when the user asks to change ad spend.
 */
export const updateBudgetSkill: SkillModule = {
  id: 'update-budget',
  oneLineDescription: "Change a campaign's daily budget on Meta.",
  promptFragment: `## Changing a campaign budget

Pick a recommended new amount, surface it with the current amount and reason, then ask accept or change. The path:

1. **Pick defaults silently.** Call \`listCampaigns\` to see current budgets. For the campaign the user named (or asked about implicitly), work out:
   - **Recommended new amount** — based on current spend, learning-phase status, and what would be a sensible step (e.g. a ~20% bump for a post-learning campaign that's converting). If the campaign is still in learning, the recommendation is "wait, don't change."
   - **Reason** — one line tied to the campaign's state.
2. **Surface and ask.** One message: campaign name, current budget (in euros), recommended new budget (in euros), one-line reason. Then ask one question: go with that, or pick a different amount?
3. **Branch on the answer.**
   - **Accept the recommendation** → call \`confirmUpdateBudget\` with the current and recommended amounts, then \`executeUpdateBudget\` on approval.
   - **Different amount** → take their number, run the learning-phase + scaling checks against it, then \`confirmUpdateBudget\` → \`executeUpdateBudget\`.
   - **Reject entirely** → leave the budget alone, tell them what's blocking the change (learning phase, etc.) if that's the reason.

A few things to keep right:
- The API uses cents — 100 = €1/day, minimum €1/day. Always show the user amounts in euros, not cents. Internal API call = cents; conversation = euros.
- I never change a live campaign's budget during the learning phase (first 7 to 10 days). The algorithm's still finding its feet — changing the budget resets the clock. If learning's still active, the recommended action is "wait."
- I never recommend scaling (raising the budget) before the learning phase exits. If they ask to bump a learning-phase campaign, the answer is wait, then revisit once it's out of learning.
- When the change is a decrease, the same learning-phase rule applies — no changes during learning.`,
  toolNames: ['listCampaigns', 'confirmUpdateBudget', 'executeUpdateBudget'],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: [
    'noLiveCampaignChangeDuringLearningPhase',
    'noScalingBeforeLearningExits',
  ],
};
