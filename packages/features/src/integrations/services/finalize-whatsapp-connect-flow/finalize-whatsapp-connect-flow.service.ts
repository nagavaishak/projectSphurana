import { createLogger, trackOrgEvent } from '@borradh-workspace/observability';
import { syncWhatsappTemplates } from '../../../campaigns/index.js';
import type { DbConnection } from '../../../shared/index.js';
import {
  type FinalizeWhatsAppConnectionInput,
  type FinalizeWhatsAppConnectionResult,
  finalizeWhatsAppConnection,
} from '../finalize-whatsapp-connection/index.js';

const logger = createLogger('FinalizeWhatsappConnectFlow');

/**
 * `POST /integrations/whatsapp/finalize` — the Embedded Signup completion, end
 * to end.
 *
 * `finalizeWhatsAppConnection` does the Meta work (code → biSUAT, phone numbers,
 * webhook subscription, `whatsappAccount` upsert). This adds the three things
 * the entry point was carrying on top of it, none of which are transport:
 *
 *   1. the `integrations.whatsapp_connect.callback` analytics event on both
 *      branches (property keys unchanged: `status`, `errorCode`);
 *   2. the failure log line;
 *   3. the best-effort template-cache seed, so the composer and Claire can
 *      offer templates the moment the WABA is linked. A sync failure is logged
 *      and swallowed — it must never fail a connect that already succeeded.
 *
 * The error Result is returned UNCHANGED. The entry point still renders every
 * failure as 400, exactly as before, so no code needs re-mapping here.
 */
export const finalizeWhatsappConnectFlow = async (
  db: DbConnection,
  input: FinalizeWhatsAppConnectionInput
): Promise<FinalizeWhatsAppConnectionResult> => {
  const { organizationId, connectedById, wabaId } = input;
  logger.info(`WhatsApp embedded-signup finalize for org: ${organizationId}`);

  const result = await finalizeWhatsAppConnection(db, input);

  if (!result.success) {
    logger.warn(
      `WhatsApp finalize failed (${result.error.code}): ${result.error.message}`,
      { organizationId, userId: connectedById, wabaId }
    );
    trackOrgEvent(organizationId, 'integrations.whatsapp_connect.callback', {
      status: 'connect_failed',
      errorCode: result.error.code,
    });
    return result;
  }

  trackOrgEvent(organizationId, 'integrations.whatsapp_connect.callback', {
    status: 'success',
  });

  const sync = await syncWhatsappTemplates(db, {
    organizationId,
    refresh: true,
  });
  if (!sync.success) {
    logger.warn(
      `WhatsApp template sync after connect failed: ${sync.error.message}`,
      { organizationId }
    );
  }

  return result;
};

export type FinalizeWhatsappConnectFlowResult = Awaited<
  ReturnType<typeof finalizeWhatsappConnectFlow>
>;
