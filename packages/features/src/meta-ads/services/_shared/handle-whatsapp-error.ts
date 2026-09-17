/**
 * WhatsApp Cloud API error handler.
 *
 * Lives beside `handle-meta-error.ts` rather than in `integrations/` because
 * that is its only dependency, and because every WhatsApp-calling context
 * (integrations, campaigns, sequences) needs it. `meta-ads` is a leaf in the
 * cross-domain barrel graph — it imports no sibling barrel — so reaching it
 * from any domain is cycle-free, whereas routing this through
 * `integrations/index.js` closes a barrel-to-barrel cycle with `campaigns`.
 *
 * Thin wrapper around handleMetaError that:
 *   - tags log entries with `feature: 'whatsapp'`
 *   - uses ErrorCodes.INTERNAL_ERROR as the default fallback (no
 *     WhatsApp-specific FeatureError code namespace exists)
 *   - sets a WhatsApp-flavoured default user-facing title
 *   - optionally marks the org's WhatsApp accounts as needs_reconnect on
 *     auth errors (when `db` and `organizationId` are passed)
 *
 * Why we share handleMetaError instead of duplicating it:
 * WhatsApp Cloud API runs on Meta Graph API and uses the same error envelope
 * format. The registry in packages/integrations/src/shared/meta-error-registry.ts
 * is the single source of truth for both Meta Ads and WhatsApp error mapping.
 */

import { type DbConnection, ErrorCodes } from '../../../shared/index.js';
import { handleMetaError } from './handle-meta-error.js';

export interface HandleWhatsAppErrorOptions {
  /** Operation name for logging, e.g. 'integrations.createWhatsappTemplate' */
  operationName: string;
  /** Extra context for the log entry (account IDs, template names, etc.) */
  extra?: Record<string, unknown>;
  /** FeatureError code to use when the registry has no match. */
  defaultErrorCode?: string;
  /** User-facing dialog title to use when the registry has no match. */
  defaultUserTitle?: string;
  /**
   * DB + org context. When both are provided, an auth_required error
   * marks the org's WhatsApp accounts as needs_reconnect so the
   * integrations page can show a Reconnect banner.
   */
  db?: DbConnection;
  organizationId?: string;
}

export function handleWhatsAppError(
  error: unknown,
  options: HandleWhatsAppErrorOptions
) {
  return handleMetaError(error, {
    operationName: options.operationName,
    extra: options.extra,
    defaultErrorCode: options.defaultErrorCode ?? ErrorCodes.INTERNAL_ERROR,
    defaultUserTitle: options.defaultUserTitle ?? 'WhatsApp Request Failed',
    feature: 'whatsapp',
    db: options.db,
    organizationId: options.organizationId,
    reconnectIntegrationType: 'whatsapp',
  });
}
