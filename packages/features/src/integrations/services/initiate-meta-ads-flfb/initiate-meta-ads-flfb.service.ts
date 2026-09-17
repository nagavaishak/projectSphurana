import { createLogger, trackOrgEvent } from '@borradh-workspace/observability';
import type { DbConnection } from '../../../shared/index.js';
import {
  type InitiateMetaOAuthResult,
  initiateMetaOAuth,
} from '../connect-meta-ads/index.js';

const logger = createLogger('InitiateMetaAdsFlfb');

export interface InitiateMetaAdsFlfbInput {
  organizationId: string;
  userId: string;
  /** Authorization code returned in-page by the FLFB popup (no redirect_uri). */
  code: string;
}

/**
 * `POST /integrations/meta-ads/initiate` — the Facebook Login for Business
 * popup finalize.
 *
 * `flfb: true` is not a caller choice: it IS this flow. The popup returns its
 * code redirect-lessly, which requires the single-call exchange for a
 * non-expiring system-user token rather than the classic short→long-lived
 * two-step. Pinning it here means the entry point no longer carries a magic
 * boolean, and no caller can accidentally send the wrong exchange down this
 * route.
 *
 * The `integrations.meta_ads_connect.callback` event (both branches, same
 * property keys — `status`, `errorCode`, `initiator: 'flfb-popup'`) and the
 * failure log line move with it.
 *
 * The error Result passes through untouched: the entry point renders every
 * failure as 400, unchanged.
 */
export const initiateMetaAdsFlfb = async (
  db: DbConnection,
  input: InitiateMetaAdsFlfbInput
): Promise<InitiateMetaOAuthResult> => {
  const { organizationId, userId, code } = input;
  logger.info(`Meta Ads FLFB initiate for org: ${organizationId}`);

  const result = await initiateMetaOAuth(db, {
    organizationId,
    userId,
    code,
    flfb: true,
  });

  if (!result.success) {
    logger.warn(
      `Meta Ads FLFB initiate failed (${result.error.code}): ${result.error.message}`,
      { organizationId, userId }
    );
    trackOrgEvent(organizationId, 'integrations.meta_ads_connect.callback', {
      status: 'connect_failed',
      errorCode: result.error.code,
      initiator: 'flfb-popup',
    });
    return result;
  }

  trackOrgEvent(organizationId, 'integrations.meta_ads_connect.callback', {
    status: 'success',
    initiator: 'flfb-popup',
  });

  return result;
};

export type InitiateMetaAdsFlfbResult = Awaited<
  ReturnType<typeof initiateMetaAdsFlfb>
>;
