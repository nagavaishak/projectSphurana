import { z } from 'zod';

/**
 * The single in-flight destructive-action gate stored on an
 * `assistant_conversation` row (`pendingConfirmation` jsonb, WS-4). On the
 * WhatsApp channel a preview tool persists this when it shows an ad/offer
 * preview; the worker (WS-10) reads it to decide whether an inbound text
 * affirmation ("launch"/"yes, publish") should satisfy the publish gate.
 *
 * The DB column type is `{ kind: string; draftId: string } | null`; we narrow
 * `kind` to the two preview kinds Claire emits today.
 */
export const pendingConfirmationKindSchema = z.enum(['ad', 'offer']);

export type PendingConfirmationKind = z.infer<
  typeof pendingConfirmationKindSchema
>;

export interface PendingConfirmation {
  kind: PendingConfirmationKind;
  draftId: string;
}

const conversationLocatorSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
});

export const setPendingConfirmationSchema = conversationLocatorSchema.extend({
  kind: pendingConfirmationKindSchema,
  draftId: z.string().min(1),
});

export type SetPendingConfirmationInput = z.infer<
  typeof setPendingConfirmationSchema
>;

export const clearPendingConfirmationSchema = conversationLocatorSchema;

export type ClearPendingConfirmationInput = z.infer<
  typeof clearPendingConfirmationSchema
>;

export const getPendingConfirmationSchema = conversationLocatorSchema;

export type GetPendingConfirmationInput = z.infer<
  typeof getPendingConfirmationSchema
>;
