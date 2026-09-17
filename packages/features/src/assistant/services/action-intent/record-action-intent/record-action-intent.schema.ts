import { claireActionIntentTypeValues } from '@borradh-workspace/database';
import { z } from 'zod';

/**
 * Record a normalised Claire action intent for later dedupe (Phase 4).
 *
 * Called after a create/launch succeeds (or when a launch goes in-flight) so a
 * subsequent identical request can be resolved to this resource instead of
 * spawning a duplicate.
 */
export const recordActionIntentSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  conversationId: z.string().min(1).optional(),
  action: z.enum(claireActionIntentTypeValues),
  /** Raw signature the recorder normalises (e.g. campaign name + objective). */
  key: z.string().min(1, 'A key is required'),
  /** The resource the intent produced/targets (null while in-flight). */
  resourceId: z.string().min(1).optional(),
  /** Original-casing label for the picker card. */
  displayName: z.string().min(1).optional(),
  /** Structured context used to score similarity + describe the candidate. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type RecordActionIntentInput = z.infer<typeof recordActionIntentSchema>;
