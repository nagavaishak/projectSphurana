import type { OrgSmsNumber, OrgSmsSender } from '@borradh-workspace/database';
import {
  deriveAlphaSenderId,
  isValidAlphaSenderId,
} from './alpha-sender-id.js';

/**
 * The resolved campaign-SMS sender for an org. `alpha` sends go out through the
 * Messaging Service with a branded sender ID (one-way); `number` sends go from
 * the org's dedicated number (two-way). `none` means the org cannot send SMS
 * yet, with a user-facing reason.
 */
export type ResolvedSmsSender =
  | { mode: 'alpha'; senderId: string }
  | { mode: 'number'; phoneNumber: string }
  | { mode: 'none'; reason: string };

export interface ResolveSmsSenderInput {
  /** The org's explicit sender config, if any (absent ⇒ alpha default). */
  sender: OrgSmsSender | null;
  /** The org's provisioned number, if any (used only in `number` mode). */
  number: OrgSmsNumber | null;
  /** The org's display name — derives the alpha sender ID when none is set. */
  orgName: string;
}

/**
 * Resolve how an org sends campaign SMS. Pure — the worker reads the rows and
 * passes them in.
 *
 * - No sender row ⇒ alpha default: use `sender_id` override or derive from the
 *   org name. If neither yields a valid id, `none` (org must set an override).
 * - `number` mode ⇒ the active provisioned number, else `none`.
 */
export function resolveSmsSender(
  input: ResolveSmsSenderInput
): ResolvedSmsSender {
  const { sender, number, orgName } = input;

  if (sender?.mode === 'number') {
    if (number?.status === 'active') {
      return { mode: 'number', phoneNumber: number.phoneNumber };
    }
    return {
      mode: 'none',
      reason: 'Number sending is selected but no active number is provisioned',
    };
  }

  // Alpha (the default when no row exists).
  const override = sender?.senderId ?? null;
  if (override) {
    return isValidAlphaSenderId(override)
      ? { mode: 'alpha', senderId: override }
      : {
          mode: 'none',
          reason: `Configured sender ID "${override}" is not a valid alphanumeric sender ID`,
        };
  }

  const derived = deriveAlphaSenderId(orgName);
  if (derived) return { mode: 'alpha', senderId: derived };

  return {
    mode: 'none',
    reason:
      'Could not derive a sender ID from the organization name — set one explicitly',
  };
}
