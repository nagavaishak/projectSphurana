import { getMetaErrorInfo } from '@borradh-workspace/integrations';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getMetaCredentials, logMetaErrorIfUnknown } from '../_shared/index.js';
import {
  type HealthCheckInput,
  healthCheckSchema,
} from './health-check.schema.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HealthCheckStatus = 'pass' | 'fail' | 'warn';

export interface HealthCheckItem {
  check: string;
  status: HealthCheckStatus;
  detail?: string;
  actionUrl?: string;
  actionLabel?: string;
  videoGuideSlug?: string;
}

export interface HealthCheckResult {
  overall: HealthCheckStatus;
  checks: HealthCheckItem[];
}

// Account status codes from Meta API
// 1=Active, 2=Disabled, 3=Unsettled, 7=Pending Review, 9=Grace Period, 100=Pending Closure, 101=Closed
const ACCOUNT_STATUS_LABELS: Record<number, string> = {
  1: 'Active',
  2: 'Disabled',
  3: 'Unsettled',
  7: 'Pending Review',
  9: 'Grace Period',
  100: 'Pending Closure',
  101: 'Closed',
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

const healthCheckImpl = async (
  db: DbConnection,
  input: HealthCheckInput
): Promise<Result<HealthCheckResult>> => {
  const parsed = healthCheckSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaAdsPageId, requireInstagram } = parsed.data;

  // Get credentials
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
    operationName: 'metaAds.healthCheck',
  });
  if (!credResult.success) return credResult;

  const { credentials, resolvedPage } = credResult.data;
  const metaService = new MetaAdsService(credentials);
  const checks: HealthCheckItem[] = [];

  // ── Check 0: Token validity ──
  // Call a lightweight endpoint first. If Meta requires verification or the
  // token is invalid, short-circuit — all other checks are meaningless.
  // We cache the result so Check 2 can reuse it without a second API call.
  let cachedPageInfo: Awaited<
    ReturnType<typeof metaService.getPageAccess>
  > | null = null;

  try {
    cachedPageInfo = await metaService.getPageAccess(resolvedPage.pageId);
  } catch (error) {
    const errorInfo = getMetaErrorInfo(error);
    const isAuthOrCheckpoint =
      errorInfo?.category === 'auth_required' ||
      errorInfo?.category === 'user_action_required';

    if (isAuthOrCheckpoint && errorInfo) {
      // Token/account-level issue — return only this one check
      logMetaErrorIfUnknown('metaAds.healthCheck.tokenCheck', error, {
        organizationId,
      });

      checks.push({
        check: 'meta_connection',
        status: 'fail',
        detail: errorInfo.userMessage,
        actionUrl: errorInfo.actionUrl,
        actionLabel: errorInfo.actionLabel,
        videoGuideSlug: errorInfo.videoGuideSlug,
      });

      return ok({ overall: 'fail' as HealthCheckStatus, checks });
    }
    // Not an auth error — fall through, let the page access check below
    // handle it with a more specific message
  }

  // ── Check 1: Account status + payment + spending limit ──
  try {
    const health = await metaService.getAdAccountHealth();

    // Account status
    const statusLabel =
      ACCOUNT_STATUS_LABELS[health.accountStatus] ?? 'Unknown';
    if (health.accountStatus === 1 || health.accountStatus === 9) {
      checks.push({
        check: 'account_status',
        status: 'pass',
        detail: statusLabel,
      });
    } else {
      checks.push({
        check: 'account_status',
        status: 'fail',
        detail: `Your ad account is ${statusLabel.toLowerCase()}. ${health.disableReason === 1 ? 'This may be due to ads integrity violations.' : health.disableReason === 2 ? 'This may be due to outstanding payments.' : 'Check Meta Business Manager for details.'}`,
        actionUrl: 'https://business.facebook.com/accountquality',
        actionLabel: 'Check Account Quality',
        videoGuideSlug: 'check-account-quality',
      });
    }

    // Payment method
    if (health.hasPaymentMethod) {
      checks.push({
        check: 'payment_method',
        status: 'pass',
        detail: 'Payment method configured',
      });
    } else if (health.fundingDataWithheld) {
      // Meta omitted funding_source_details entirely. This is NOT a reliable
      // signal of a missing payment method — Meta routinely withholds this
      // field on perfectly healthy accounts (verification pending, EU/regional
      // restrictions, or transient API issues). Surface it as a warning, not a
      // hard fail, so it doesn't block launch on accounts that bill fine. If
      // billing is genuinely broken, Meta rejects the ad at publish with a
      // specific, registry-classified error.
      checks.push({
        check: 'payment_method',
        status: 'warn',
        detail:
          'We could not read your billing details from Meta. This is often fine — if your ads fail to deliver, check Meta Business Manager for any pending verification.',
        actionUrl: 'https://business.facebook.com/accountquality',
        actionLabel: 'Check Account Status',
        videoGuideSlug: 'business-verification',
      });
    } else {
      checks.push({
        check: 'payment_method',
        status: 'fail',
        detail:
          'No valid payment method. Add a payment method in Meta Business Manager before launching ads.',
        actionUrl: 'https://business.facebook.com/billing_hub/payment_settings',
        actionLabel: 'Go to Meta Billing',
        videoGuideSlug: 'add-payment-method',
      });
    }

    // Spending limit
    // NOTE: amount_spent on the ad account is unreliable — it resets when the
    // spend cap is reset in Business Manager. Instead, check if Meta is actually
    // blocking campaign delivery due to the spending limit (WITH_ISSUES status
    // + issues_info mentioning the cap).
    const spendCap = Number(health.spendCap);
    if (spendCap > 0) {
      const isCapReached = await metaService.isSpendingLimitReached();

      if (isCapReached) {
        // Detected by string-matching Meta's issues_info, which is unreliable
        // and often stale (e.g. right after a cap is raised or a campaign
        // unpaused). Warn rather than hard-block launch — a genuinely capped
        // account simply won't deliver, and Meta surfaces that explicitly.
        checks.push({
          check: 'spending_limit',
          status: 'warn',
          detail:
            'Your ad account may have reached its spending limit. If ads don’t deliver, increase or remove the limit in Meta Business Settings.',
          actionUrl:
            'https://business.facebook.com/billing_hub/payment_settings',
          actionLabel: 'Update Spending Limit',
          videoGuideSlug: 'increase-spending-limit',
        });
      } else {
        checks.push({
          check: 'spending_limit',
          status: 'pass',
          detail: 'Spending limit set, ads delivering normally',
        });
      }
    } else {
      // No spending limit set = pass
      checks.push({
        check: 'spending_limit',
        status: 'pass',
        detail: 'No spending limit set',
      });
    }
  } catch (error) {
    logMetaErrorIfUnknown('metaAds.healthCheck.accountHealth', error, {
      organizationId,
    });

    // Use registry to show the specific error (e.g., checkpoint, token expired)
    const errorInfo = getMetaErrorInfo(error);
    checks.push({
      check: 'account_status',
      status: 'fail',
      detail:
        errorInfo?.userMessage ??
        'Could not verify ad account status. Your Meta connection may have expired.',
      actionUrl: errorInfo?.actionUrl,
      actionLabel: errorInfo?.actionLabel ?? 'Reconnect',
      videoGuideSlug: errorInfo?.videoGuideSlug ?? 'reconnect-meta',
    });
  }

  // ── Check 2: Page access ──
  // Reuse the cached result from Check 0 when available.
  if (cachedPageInfo) {
    checks.push({
      check: 'page_access',
      status: 'pass',
      detail: `Page "${cachedPageInfo.name}" is accessible`,
    });

    // ── Check 3: Instagram linked (if required) ──
    if (requireInstagram) {
      if (cachedPageInfo.instagramBusinessAccount) {
        checks.push({
          check: 'instagram_linked',
          status: 'pass',
          detail: 'Instagram Professional account is linked',
        });
      } else {
        checks.push({
          check: 'instagram_linked',
          status: 'fail',
          detail:
            'Your Facebook Page is not linked to an Instagram Professional account. Go to your Page settings to connect one.',
          actionUrl: 'https://business.facebook.com/settings/instagram',
          actionLabel: 'Link Instagram',
          videoGuideSlug: 'link-instagram-page',
        });
      }
    }
  } else {
    // Check 0 failed with a non-auth error — retry to get a specific message
    try {
      const pageInfo = await metaService.getPageAccess(resolvedPage.pageId);
      checks.push({
        check: 'page_access',
        status: 'pass',
        detail: `Page "${pageInfo.name}" is accessible`,
      });

      if (requireInstagram) {
        if (pageInfo.instagramBusinessAccount) {
          checks.push({
            check: 'instagram_linked',
            status: 'pass',
            detail: 'Instagram Professional account is linked',
          });
        } else {
          checks.push({
            check: 'instagram_linked',
            status: 'fail',
            detail:
              'Your Facebook Page is not linked to an Instagram Professional account. Go to your Page settings to connect one.',
            actionUrl: 'https://business.facebook.com/settings/instagram',
            actionLabel: 'Link Instagram',
            videoGuideSlug: 'link-instagram-page',
          });
        }
      }
    } catch (error) {
      logMetaErrorIfUnknown('metaAds.healthCheck.pageAccess', error, {
        organizationId,
        pageId: resolvedPage.pageId,
      });

      const errorInfo = getMetaErrorInfo(error);
      checks.push({
        check: 'page_access',
        status: 'fail',
        detail:
          errorInfo?.userMessage ??
          'Could not verify Facebook Page access. You may have lost admin access or your connection expired.',
        actionUrl:
          errorInfo?.actionUrl ??
          'https://business.facebook.com/settings/pages',
        actionLabel: errorInfo?.actionLabel ?? 'Check Page Settings',
        videoGuideSlug: errorInfo?.videoGuideSlug ?? 'page-roles',
      });
    }
  }

  // Compute overall status
  const hasFail = checks.some((c) => c.status === 'fail');
  const hasWarn = checks.some((c) => c.status === 'warn');
  const overall: HealthCheckStatus = hasFail
    ? 'fail'
    : hasWarn
      ? 'warn'
      : 'pass';

  return ok({ overall, checks });
};

export const healthCheck = (db: DbConnection, input: HealthCheckInput) =>
  trackedResult('metaAds.healthCheck', () => healthCheckImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });
