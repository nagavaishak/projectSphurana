import { db } from '@borradh-workspace/database';
import {
  appendLoadedSkill,
  getSkillById,
} from '@borradh-workspace/features/assistant';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `load_skill` — let Claire pivot to a different task mid-conversation.
 *
 * Always loaded (the controller includes the result of `metaTools` in every
 * turn's tool set). The intent classifier (`classifyIntent`) only fires on
 * the conversation's first turn; from there on, mid-conversation pivots come
 * through this tool.
 *
 * **Mid-turn rebuild requirement (W-C03-D-finish)**: when this tool fires
 * inside a turn, the controller must rebuild the active tool list before
 * the next model round in the same turn. Otherwise the model can't actually
 * call any of the newly-loaded skill's tools until the next user send. The
 * controller reads `currentLoadedSkills` from the tool's return shape (or
 * re-queries the row) to decide what's in scope. That wiring lives in
 * W-C03-D-finish.
 *
 * **Persistence (this window — W-C03-D-prep)**: the tool now calls
 * `appendLoadedSkill` (features service) to atomically union the skill into
 * `assistant_conversation.loaded_skill_ids`. Idempotent and concurrent-safe
 * — the SQL dedupes via `array(select distinct unnest(... || ...))`.
 *
 * The tool returns
 * `{ loaded, skillId, newToolsAvailable, promptFragment, currentLoadedSkills }`
 * so the model can use the freshly-loaded toolset *without* waiting for the
 * next system-prompt round-trip, and so the controller knows the new active
 * skill set without re-querying.
 */
export const loadSkillTool = defineTool<
  { skillId: string },
  {
    loaded: boolean;
    skillId: string;
    newToolsAvailable: string[];
    promptFragment: string;
    currentLoadedSkills: string[];
  }
>({
  feature: 'meta',
  action: 'loadSkill',
  description:
    'Load a skill module to access its tools and instructions. Use when the user pivots to a different task mid-conversation (e.g. they were creating an ad, and now they want to schedule a post). The available skill IDs are listed in the orchestrator system prompt.',
  inputSchema: z.object({
    skillId: z
      .string()
      .min(1)
      .describe(
        'The ID of the skill to load. Must be one of the available skill IDs listed in the orchestrator system prompt.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Switching focus' },
  execute: async ({ skillId }, ctx) => {
    const skill = getSkillById(skillId);
    if (!skill) {
      throw new Error(
        `Unknown skill ID "${skillId}". Use one of the IDs listed in the skill index in the system prompt.`
      );
    }

    const result = await appendLoadedSkill(db, {
      conversationId: ctx.conversationId,
      organizationId: ctx.organizationId,
      skillId: skill.id,
    });

    if (!result.success) {
      // The service's VALIDATION_ERROR path covers an unknown id (caught
      // above); a NOT_FOUND here means the conversation row vanished
      // mid-turn (highly unlikely but possible if a parallel delete fired)
      // and INTERNAL_ERROR signals a DB failure. Either way the model
      // should retry or recover; the factory's error sanitization
      // surfaces the message verbatim.
      throw new Error(
        `Failed to load skill "${skill.id}": ${result.error.message}`
      );
    }

    return {
      data: {
        loaded: true,
        skillId: skill.id,
        newToolsAvailable: skill.toolNames,
        promptFragment: skill.promptFragment,
        currentLoadedSkills: result.data.loadedSkillIds,
      },
    };
  },
});
