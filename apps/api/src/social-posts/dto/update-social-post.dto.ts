import { updateSocialPostRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT social-posts/:id` body. Sourced from the canonical wire contract, so the
 * DTO cannot drift from what the frontend builder emits or from what
 * `updateSocialPost` accepts (both derive from the same base). The narrowing of
 * `status` to `draft` / `scheduled` — a client may not claim a post was
 * published — lives in the contract.
 */
export class UpdateSocialPostDto extends createZodDto(
  updateSocialPostRequestSchema
) {}
