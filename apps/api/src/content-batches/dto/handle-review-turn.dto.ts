import { handleReviewTurnSchema } from '@borradh-workspace/features/content-batches';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /content-batches/items/:itemId/messages — one turn of the
 * per-post review thread. `itemId` comes from the path, `organizationId` and
 * `userId` from the session; only the instruction arrives from the client.
 *
 * Every server-supplied field MUST be omitted here, not just the obvious two:
 * anything left in the DTO is REQUIRED of the client, and the client has no
 * business knowing it. `userId` joined the service schema when swaps started
 * minting assets, and leaving it in rejected every turn with a bare
 * `400 Validation failed` before the service ran — so no message was sent and
 * none was persisted.
 */
export class ReviewTurnDto extends createZodDto(
  handleReviewTurnSchema.omit({
    itemId: true,
    organizationId: true,
    userId: true,
  })
) {}
