import { db } from '@borradh-workspace/database';
import type { ClaireConfirmationAction } from '@borradh-workspace/database';
import {
  type ConfirmationVerification,
  createConfirmationToken,
  verifyConfirmationToken,
} from '@borradh-workspace/features/assistant';

/**
 * DB-backed confirmation token CRUD. Replaces the v2 in-memory store.
 *
 * The factory's wrapped execute calls these helpers via the request-scoped
 * `AssistantToolsContext`. Token storage lives in the
 * `claire_confirmation_token` table (W-C02-B); this module is the thin glue
 * that turns features-package services into context-friendly helpers.
 *
 * `feedback_no_db_in_api`: this file lives in `apps/api/` but does not
 * write SQL — it delegates to the features-package service which owns the
 * `db` handle. The factory's `apiFetch` covers internal HTTP; confirmations
 * are too tightly bound to the request lifecycle to round-trip via HTTP, so
 * we call the service directly. Same pattern the existing controller uses
 * for `getAssistantContext`, `queryKnowledge`, etc.
 */

export interface CreateConfirmationFnInput {
  organizationId: string;
  conversationId: string;
  action: ClaireConfirmationAction;
  resourceId: string;
  payload?: Record<string, unknown>;
}

export interface CreatedConfirmation {
  id: string;
  expiresAt: Date;
}

/**
 * Issue a fresh confirmation token row. The factory calls this on the
 * first invocation of a destructive tool (no `confirmationToken` in input).
 * The token id is what the model echoes back on the second call.
 *
 * Throws on internal error so the factory can short-circuit cleanly.
 */
export async function createConfirmation(
  input: CreateConfirmationFnInput
): Promise<CreatedConfirmation> {
  const result = await createConfirmationToken(db, input);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
}

export interface VerifyConfirmationFnInput {
  organizationId: string;
  conversationId: string;
  action: ClaireConfirmationAction;
  /**
   * Optional. Omit for create-style tools whose input doesn't naturally
   * carry the resourceId back on the second call — see
   * `verify-confirmation-token.schema.ts` for the rationale.
   */
  resourceId?: string;
  token: string;
}

/**
 * Verify-and-consume a confirmation token. Returns a discriminated result;
 * never throws on the expected `(expired | consumed | mismatch | not_found | no_user_turn)`
 * outcomes. Throws only on truly unexpected DB failures.
 */
export async function verifyConfirmation(
  input: VerifyConfirmationFnInput
): Promise<ConfirmationVerification> {
  const result = await verifyConfirmationToken(db, input);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.data;
}
