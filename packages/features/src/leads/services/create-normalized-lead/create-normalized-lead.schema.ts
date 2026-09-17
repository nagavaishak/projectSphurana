import type { z } from 'zod';
import { createLeadSchema } from '../create-lead/create-lead.schema.js';

/**
 * Same input as a plain create — normalisation only rewrites identity fields
 * that are already part of it. Reused verbatim so the two can never drift.
 */
export const createNormalizedLeadSchema = createLeadSchema;

export type CreateNormalizedLeadInput = z.infer<
  typeof createNormalizedLeadSchema
>;
