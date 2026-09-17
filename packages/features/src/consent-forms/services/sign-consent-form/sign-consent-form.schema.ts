import { z } from 'zod';
import { consentFormFieldDataSchema } from '../shared/field.schema.js';

export const signConsentFormSchema = z.object({
  /** The signed-in patient's lead.id — from the VALIDATED session, never the client. */
  leadId: z.string().min(1, 'Lead ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  submissionId: z.string().min(1, 'Submission ID is required'),
  fieldData: consentFormFieldDataSchema.default({}),
  signedByName: z.string().max(200).optional(),
  /**
   * The attestation checkbox. Enforced SERVER-SIDE in the service
   * (`attested !== true` → VALIDATION_ERROR) — never just UI-disabled.
   */
  attested: z.boolean(),
  /**
   * Drawn signature as a PNG data URL. Required when the template snapshot
   * has `requiresSignature` (enforced in the service, where the snapshot is
   * known). Decoded size is capped at 200KB — also enforced in the service,
   * where the decode happens exactly once.
   */
  signatureImageDataUrl: z
    .string()
    .regex(/^data:image\/png;base64,/, 'Signature must be a PNG image')
    .optional(),
  /** Request IP, captured by the controller (`req.ip`) — never client-supplied. */
  signedIp: z.string().max(100).optional(),
});

export type SignConsentFormInput = z.infer<typeof signConsentFormSchema>;
