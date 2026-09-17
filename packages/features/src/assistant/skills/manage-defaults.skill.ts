import type { SkillModule } from './types.js';

/**
 * Manage-defaults skill — loaded when the operator wants to view or change
 * the per-org defaults Claire uses during creation flows (ad budget,
 * objective, video orientation/length, brand voice, default service).
 *
 * Two trigger paths:
 *   1. Direct: "what's my default ad budget?" / "make €20/day my default"
 *   2. Indirect: a Created card's "make this my default" button prompts
 *      Claire with a specific value-promotion ask, which the classifier
 *      routes here.
 *
 * The single tool is `setOrgDefault` (non-destructive — writes to settings
 * only, no spend or publishing). For reads, the orchestrator already has
 * the resolved defaults in business context so no tool call is needed.
 */
export const manageDefaultsSkill: SkillModule = {
  id: 'manage-defaults',
  oneLineDescription:
    'View or change Claire’s per-org defaults (ad budget, video orientation, brand voice, default service).',
  promptFragment: `## Working with org defaults

Per-org defaults are the values Claire fills in automatically during creation when the operator doesn't specify them. They live in org settings under Defaults. The resolved values are already in your business context above — read them straight from there for "what's my default X" questions; no tool call needed.

**Changing a default**
- For "make €20/day my default ad budget" / "set my default video to portrait" etc., call \`setOrgDefault\` with the right \`key\` and \`value\`.
- The "make this my default" buttons on Created cards always include the specific value in the prompt text — pull it from there, don't reverse-engineer it from earlier context.
- Confirm back with the human-friendly summary the tool returns. One short line. No follow-up survey questions.

**Clearing a default**
- "Remove my default video length" / "stop overriding the ad objective" → call \`setOrgDefault\` with \`value: null\`. Claire then falls back to the system default for that field on the next creation.

**Keys you can set**
- \`adDailyBudgetCents\` — number in cents (€20/day = 2000)
- \`adObjective\` — OUTCOME_LEADS | OUTCOME_TRAFFIC | OUTCOME_AWARENESS
- \`videoOrientation\` — landscape | portrait | square
- \`videoLengthSecs\` — positive integer
- \`brandVoice\` — free-form text (max one short paragraph)
- \`defaultServiceIdForAds\` — service ID from \`listServices\`

**What not to do**
- Don't change a default mid-creation flow as a side effect of "use €20 here". The operator only promotes a value to a default when they explicitly ask. If they want a value for one campaign only, pass it to the creation tool directly.`,
  toolNames: ['setOrgDefault'],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
  hardBlocks: [],
};
