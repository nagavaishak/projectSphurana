import { z } from 'zod';

/**
 * Lifecycle transitions the troubleshoot loop can request:
 *   - `mark_diagnosed`     → stamp `lastDiagnosedAt` (no round change).
 *   - `offer_adjusted`     → round 1: lower the intro price, same service.
 *   - `creative_refreshed` → round 2: new creative, same offer.
 *   - `escalate`           → hand off to a human; stamp `escalatedAt`.
 */
export const troubleshootActionValues = [
  'mark_diagnosed',
  'offer_adjusted',
  'creative_refreshed',
  'escalate',
] as const;

export type TroubleshootAction = (typeof troubleshootActionValues)[number];

export const advanceTroubleshootStateSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  metaCampaignId: z.string().min(1, 'Campaign ID is required'),
  action: z.enum(troubleshootActionValues),
  /** Human description of what changed, recorded on the attempt trail. */
  note: z.string().max(500).optional(),
  /** Optional id of the created offer/video the attempt produced. */
  ref: z.string().max(200).optional(),
});

export type AdvanceTroubleshootStateInput = z.infer<
  typeof advanceTroubleshootStateSchema
>;
