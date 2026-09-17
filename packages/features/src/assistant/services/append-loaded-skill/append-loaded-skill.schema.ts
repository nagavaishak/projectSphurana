import { z } from 'zod';

/**
 * Input shape for `appendLoadedSkill`.
 *
 * `skillId` validation against the registry is done in the service body
 * (not in the schema) so the registry is the single source of truth and
 * doesn't need to be re-listed here.
 */
export const appendLoadedSkillSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  skillId: z.string().min(1),
});

export type AppendLoadedSkillInput = z.infer<typeof appendLoadedSkillSchema>;

/**
 * Output of `appendLoadedSkill`. Returns the full updated `loadedSkillIds`
 * array so callers can echo the current state back to the model in the same
 * tool result without re-querying.
 */
export interface AppendLoadedSkillOutput {
  loadedSkillIds: string[];
}
