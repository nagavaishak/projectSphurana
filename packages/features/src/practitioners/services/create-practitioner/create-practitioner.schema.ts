import { createPractitionerRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * Schema for creating a practitioner.
 *
 * DERIVED from the canonical wire contract (`createPractitionerRequestBase` in
 * `@borradh-workspace/contracts`) by extending the server-injected context
 * field onto it. The server schema is therefore the wire schema PLUS
 * `organizationId` — it can never be laxer than what the client is told to
 * send, so the two cannot drift. Field rules (`.min(1)`, `.email()`, `.max()`,
 * the enum sets) live in the contract; do not restate them here.
 *
 * `name` stays optional at the schema level: it may be derived from first/last
 * name in the service, which rejects the case where neither is provided.
 */
export const createPractitionerSchema = createPractitionerRequestBase.extend({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /**
   * Mark the new practitioner as invited-but-not-yet-accepted (ENG-794).
   *
   * SERVER-ONLY, which is why it is added here rather than in the wire
   * contract: it is a fact about the flow that created the row, not something
   * a client may assert. Only `createTeamMember` — the one path that creates a
   * practitioner AND emails an invitation — sets it. Every other creator (the
   * onboarding wizard, imports, `ensureDefaultPractitioner`, the direct
   * `POST /practitioners`) omits it and falls through to the column default of
   * `false`, so they are bookable immediately, exactly as before.
   *
   * `.optional()` with NO `.default()`: `CreatePractitionerInput` is
   * `z.infer<>` (the OUTPUT type), so a `.default()` here would make the key
   * REQUIRED at every existing call site.
   */
  invitationPending: z.boolean().optional(),
});

export type CreatePractitionerInput = z.infer<typeof createPractitionerSchema>;
