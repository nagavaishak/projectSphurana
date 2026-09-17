/**
 * conversations request CONTRACTS — the canonical, strict Zod schema for the
 * BODY of each conversation write endpoint (the human-agent side of the inbox:
 * replying in a thread, handing a thread to a teammate).
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. `packages/features/src/conversations/services/
 * send-message/send-message.schema.ts` DERIVES from it by `.extend()`ing the
 * server-injected context fields onto the base:
 *
 *     sendMessageSchema = sendMessageRequestBase.extend({
 *       conversationId, organizationId, userId,
 *     })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE, NOT strict
 *    (`.strict()` would reject the very context fields being added).
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()`. VALIDATES a wire
 *    body; unknown keys are rejected rather than silently stripped.
 *
 * Context fields the SERVER injects, absent from every body here:
 *  - `conversationId` / `id` — the route param (`POST conversations/:id/…`).
 *  - `organizationId`        — from the active-org session.
 *  - `userId`                — the authenticated agent sending the reply. This
 *    one matters: it is what stamps authorship on an outbound message, and
 *    accepting it from the client would let one agent post as another.
 */
import { z } from 'zod';

/**
 * `POST conversations/:id/messages` body — the EXTENDABLE half.
 *
 * The single field is the agent's reply text. `.max(2000)` is not cosmetic:
 * the downstream Meta / WhatsApp send APIs reject longer payloads, so the cap
 * belongs on the wire where the composer can surface it as a character counter
 * instead of a failed delivery.
 *
 * `.min(1)` means an empty reply is a 400 — and now also a client-side parse
 * error. A textarea whose blank value is `''` must therefore be guarded by the
 * send button being disabled, not by relying on the server to reject it.
 */
export const sendMessageRequestBase = z.object({
  content: z.string().min(1, 'Message content is required').max(2000),
});

/** `POST conversations/:id/messages` body — the VALIDATING half. */
export const sendMessageRequestSchema = sendMessageRequestBase.strict();

export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

/**
 * `POST conversations/:id/assign` body — the EXTENDABLE half.
 *
 * Hands the thread to a specific teammate. `assignToUserId` is deliberately the
 * ONLY field: unassigning is not expressible here (there is no `null`), which
 * matches the service — closing or escalating a conversation are separate
 * endpoints with their own semantics.
 */
export const assignConversationRequestBase = z.object({
  assignToUserId: z.string().min(1, 'Assign to user ID is required'),
});

/** `POST conversations/:id/assign` body — the VALIDATING half. */
export const assignConversationRequestSchema =
  assignConversationRequestBase.strict();

export type AssignConversationRequest = z.infer<
  typeof assignConversationRequestSchema
>;
