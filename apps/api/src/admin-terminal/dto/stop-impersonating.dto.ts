import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Bearer clients echo the `admin_session` cookie back here.
 *
 * Better Auth reads that signed stash to find the admin to restore. Where the
 * browser stored no cookie it never had one to send, so `impersonate` hands the
 * pair back in its response body and the client returns it on the way out —
 * the same round trip `twoFactorToken` already makes on the sign-in path.
 */
const stopImpersonatingSchema = z.object({
  adminSessionToken: z.string().optional(),
});

export class StopImpersonatingDto extends createZodDto(
  stopImpersonatingSchema
) {}
