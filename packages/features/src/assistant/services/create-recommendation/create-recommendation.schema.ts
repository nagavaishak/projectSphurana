import {
  assistantActionTypeValues,
  assistantRecommendationKindValues,
} from '@borradh-workspace/database';
import { z } from 'zod';

export const assistantPrimaryActionSchema = z.object({
  label: z.string().min(1).max(80),
  type: z.enum(assistantActionTypeValues),
  // For type 'navigate': a route path like '/inbox/{conversationId}'.
  // For type 'tour':     a tour kind like 'create_ad'.
  // For type 'none':     omitted.
  target: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const createRecommendationSchema = z.object({
  organizationId: z.string().min(1),
  kind: z.enum(assistantRecommendationKindValues),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(1000),
  primaryAction: assistantPrimaryActionSchema,
  // DB column defaults to 0 — leaving this optional keeps the input type
  // ergonomic for triggers that don't care about priority.
  priority: z.number().int().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  expiresAt: z.date().optional(),
});

export type CreateRecommendationInput = z.infer<
  typeof createRecommendationSchema
>;
export type AssistantPrimaryActionInput = z.infer<
  typeof assistantPrimaryActionSchema
>;
