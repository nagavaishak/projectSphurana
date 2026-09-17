import {
  createSocialPostRequestBase,
  socialPostTargetRefinement,
  socialPostTargetRefinementOptions,
} from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a new social post.
 *
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * content.ts`, where the two targeting modes (`platforms` vs `pageIds`) and the
 * carousel `mediaUrls` field are documented.
 *
 * The cross-field invariant is re-applied here because `.refine()` yields a
 * `ZodEffects` that cannot be `.extend()`ed.
 */
export const createSocialPostSchema = createSocialPostRequestBase
  .extend({
    organizationId: z.string().min(1, 'Organization ID is required'),
    createdById: z.string().min(1, 'User ID is required'),
  })
  .refine(socialPostTargetRefinement, {
    message: socialPostTargetRefinementOptions.message,
    path: [...socialPostTargetRefinementOptions.path],
  });

/**
 * Input type inferred from schema
 */
export type CreateSocialPostInput = z.infer<typeof createSocialPostSchema>;
