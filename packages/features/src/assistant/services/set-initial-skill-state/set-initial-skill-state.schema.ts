import { z } from 'zod';

/**
 * Input shape for `setInitialSkillState`.
 *
 * `loadedSkillIds` validation against the registry is done in the service
 * body so the registry stays the single source of truth. Empty arrays are
 * accepted: the controller treats `[]` as "default skill only" via
 * `union(['default'], persisted)` at read time, so persisting `[]` is the
 * canonical "classifier returned only default" state (we never store
 * `'default'` itself — it's implicit).
 */
export const setInitialSkillStateSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  loadedSkillIds: z.array(z.string().min(1)),
  skillRegistryVersion: z.number().int().positive(),
});

export type SetInitialSkillStateInput = z.infer<
  typeof setInitialSkillStateSchema
>;

export interface SetInitialSkillStateOutput {
  loadedSkillIds: string[];
  skillRegistryVersion: number;
}
