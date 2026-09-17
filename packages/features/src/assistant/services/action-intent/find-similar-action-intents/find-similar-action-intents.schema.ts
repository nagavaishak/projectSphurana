import { claireActionIntentTypeValues } from '@borradh-workspace/database';
import { z } from 'zod';

/**
 * Pre-create similarity check (Phase 4). Reads recent normalised intents of
 * the same type for the org inside `windowDays` and scores each against the
 * proposed action so a re-request surfaces the existing candidate instead of
 * spawning a duplicate (#79 #151).
 */
export const findSimilarActionIntentsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  action: z.enum(claireActionIntentTypeValues),
  /** Proposed display name (campaign / lead form name). */
  name: z.string().optional(),
  /** Proposed objective (e.g. Meta objective, followUpType). */
  objective: z.string().optional(),
  /** Proposed service IDs — a shared service is a strong duplicate signal. */
  serviceIds: z.array(z.string()).optional(),
  /** Look-back window in days. Defaults to 7. */
  windowDays: z.number().int().positive().max(90).default(7),
  /** Minimum name similarity (0–1) for a match. Defaults to 0.5. */
  minSimilarity: z.number().min(0).max(1).default(0.5),
  /** Cap on returned candidates. Defaults to 5. */
  limit: z.number().int().positive().max(20).default(5),
});

// `z.input` (not `z.infer`) so the defaulted fields (windowDays, minSimilarity,
// limit) are OPTIONAL for callers — the schema fills them in at parse time.
export type FindSimilarActionIntentsInput = z.input<
  typeof findSimilarActionIntentsSchema
>;

export interface SimilarActionIntentCandidate {
  /** The intent row id. */
  id: string;
  /** The resource the intent produced (metaCampaignId / leadFormId), if any. */
  resourceId: string | null;
  /** Original-casing label for the card. */
  displayName: string | null;
  createdAt: string;
  /** 0–1 similarity score. */
  similarity: number;
  /** Human-readable reasons the row matched (shown on the card / to the model). */
  matchReasons: string[];
}

export interface FindSimilarActionIntentsData {
  candidates: SimilarActionIntentCandidate[];
}
