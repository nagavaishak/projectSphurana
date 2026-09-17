/**
 * Skill module types for the Claire orchestrator.
 *
 * A skill is a bundle of: an ID, a one-line description used by the intent
 * classifier, a prompt fragment to inject into the system prompt when the
 * skill is loaded, the tool names the skill exposes, and metadata about
 * model preference, when to load, extended thinking, and hard-block
 * validators to enforce.
 *
 * Skill modules live in code (TS). The skill registry version is bumped by
 * hand in `index.ts` whenever skill content changes, so in-flight
 * conversations run against frozen prompts.
 */
export interface SkillModule {
  id: string;
  oneLineDescription: string;
  promptFragment: string;
  toolNames: string[];
  preferredModel: 'sonnet' | 'opus';
  whenToLoad: 'classifier' | 'load_skill_tool' | 'always';
  extendedThinking?: { enabled: boolean; budgetTokens: number };
  hardBlocks?: string[];
}

export type SkillId =
  | 'default'
  | 'manage-campaigns'
  | 'manage-messaging-campaigns'
  | 'create-ad'
  | 'optimise-ads'
  | 'pause-ad'
  | 'update-budget'
  | 'schedule-post'
  | 'generate-video'
  | 'generate-graphic'
  | 'review-content'
  | 'manage-leads'
  | 'manage-lead-forms'
  | 'manage-appointments'
  | 'manage-offers'
  | 'manage-customer-chats'
  | 'manage-defaults'
  | 'create-offer-and-promote-v1'
  | 'weekly-marketing-review'
  | 'respond-to-low-cpl';
