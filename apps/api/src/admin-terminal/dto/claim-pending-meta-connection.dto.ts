import { claimPendingMetaConnectionSchema } from '@borradh-workspace/features/integrations';
import { createZodDto } from 'nestjs-zod';

/**
 * `pendingConnectionId` comes from the route and `claimedById` from the
 * session — neither is a caller's to name.
 */
export class ClaimPendingMetaConnectionDto extends createZodDto(
  claimPendingMetaConnectionSchema.omit({
    pendingConnectionId: true,
    claimedById: true,
  })
) {}
