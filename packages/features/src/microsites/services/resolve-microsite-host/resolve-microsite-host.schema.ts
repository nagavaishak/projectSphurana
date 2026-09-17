import { z } from 'zod';

export const resolveMicrositeHostSchema = z.object({
  /**
   * The raw `Host` header. Normalised in the service — a scheme, a port, a
   * trailing dot and mixed case all reach us in practice and all mean the same
   * host.
   */
  host: z.string().trim().min(1).max(253),
  /**
   * Request path, only consulted for the `/sites/{slug}` tier on the marketing
   * apex. Optional so a pure host lookup does not have to invent one.
   */
  path: z.string().optional(),
});

export type ResolveMicrositeHostInput = z.infer<
  typeof resolveMicrositeHostSchema
>;
