import {
  MetaAppSecretMismatchError,
  type MetaErrorCategory,
  type MetaErrorInfo,
  extractMetaErrorContext,
  getMetaErrorInfo,
  getMetaErrorMessage,
  isMetaAuthError,
} from '@borradh-workspace/integrations';
import { createLogger, logError } from '@borradh-workspace/observability';
import { handleMetaAuthError } from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';

const metaErrorLogger = createLogger('MetaError');

interface HandleMetaErrorOptions {
  operationName: string;
  credentials?: { pageId?: string };
  extra?: Record<string, unknown>;
  defaultErrorCode?: string;
  defaultUserTitle?: string;
  /**
   * Logger feature tag — defaults to 'meta-ads'. Override for other Meta-family
   * integrations that share the registry (e.g. 'whatsapp', 'instagram').
   */
  feature?: string;
  /** Database connection — required to mark integration as needs_reconnect on auth errors */
  db?: DbConnection;
  /** Organization ID — required to mark integration as needs_reconnect on auth errors */
  organizationId?: string;
  /**
   * Integration type for needs_reconnect marking on auth errors.
   * Defaults to 'meta_ads'. Pass 'instagram' or 'whatsapp' for the
   * matching integration table.
   */
  reconnectIntegrationType?: 'meta_ads' | 'instagram' | 'whatsapp';
}

/**
 * Map Meta error category → domain error code.
 * Each category gets an explicit code so the frontend can show the right UI.
 */
const CATEGORY_ERROR_CODE: Record<MetaErrorCategory, string> = {
  auth_required: AdErrorCodes.META_AUTH_EXPIRED,
  not_found: ErrorCodes.NOT_FOUND,
  permission_denied: ErrorCodes.FORBIDDEN,
  user_action_required: AdErrorCodes.META_USER_ACTION_REQUIRED,
  payment_required: AdErrorCodes.META_PAYMENT_METHOD_REQUIRED,
  rate_limited: AdErrorCodes.META_RATE_LIMITED,
  transient: ErrorCodes.INTERNAL_ERROR,
  account_restricted: AdErrorCodes.META_ACCOUNT_RESTRICTED,
  content_error: ErrorCodes.VALIDATION_ERROR,
  messaging_window: ErrorCodes.FORBIDDEN,
  user_blocked: ErrorCodes.FORBIDDEN,
  // Cosmetic sender_action refusal — never surfaced on an ads path, but the
  // Record is exhaustive so it needs a code. Nothing is actually wrong.
  sender_action_rejected: ErrorCodes.INTERNAL_ERROR,
  unknown: ErrorCodes.INTERNAL_ERROR,
};

/**
 * Resolve the error code from a MetaErrorInfo entry.
 * Applies specific overrides (e.g. TOS_LEAD_GEN) on top of the category map.
 */
function resolveErrorCode(info: MetaErrorInfo, defaultCode: string): string {
  // Specific errorKey overrides
  if (info.errorKey === 'META_TOS_LEAD_GEN') {
    return AdErrorCodes.META_LEAD_GEN_TOS_REQUIRED;
  }

  return CATEGORY_ERROR_CODE[info.category] ?? defaultCode;
}

export async function handleMetaError(
  error: unknown,
  options: HandleMetaErrorOptions
) {
  const {
    operationName,
    credentials,
    extra,
    defaultErrorCode = AdErrorCodes.META_AD_CREATE_FAILED,
    defaultUserTitle = 'Operation Failed',
    feature = 'meta-ads',
    db,
    organizationId,
    reconnectIntegrationType = 'meta_ads',
  } = options;

  // appsecret_proof mismatch — infrastructure misconfiguration, not user error.
  // Surface as an INTERNAL_ERROR but don't log to Sentry from every call.
  // TODO: root cause is META_APP_SECRET vs stored token app mismatch.
  if (error instanceof MetaAppSecretMismatchError) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Meta connection is temporarily unavailable. Please try again later.'
      )
    );
  }

  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;

  // If this is an auth error, mark the integration as needs_reconnect
  // so the user sees a reconnect prompt instead of repeated failures.
  if (
    db &&
    organizationId &&
    (isMetaAuthError(error) || isMetaAuthError(cause))
  ) {
    await handleMetaAuthError(db, error, {
      type: reconnectIntegrationType,
      organizationId,
    });
  }

  const errorMessage = getMetaErrorMessage(cause) || getMetaErrorMessage(error);
  const metaErrorInfo = getMetaErrorInfo(cause) || getMetaErrorInfo(error);

  if (metaErrorInfo) {
    // Only log unknown errors to Sentry — all classified errors are expected
    if (metaErrorInfo.category === 'unknown') {
      logError(operationName, error, {
        feature,
        extra: {
          ...extra,
          ...extractMetaErrorContext(cause),
          pgError: cause instanceof Error ? cause.message : undefined,
        },
      });
    } else {
      // Classified errors are deliberately never sent to Sentry — they're
      // expected, user-actionable outcomes. But that also meant the Meta
      // code/subcode/fbtrace_id behind a production failure was never
      // recorded anywhere, so a classified permission failure (e.g. the one
      // behind ENG-852) was unrecoverable after the fact. A warn-level
      // structured log keeps that context queryable without paging anyone.
      const metaContext = extractMetaErrorContext(cause);
      metaErrorLogger.warn('Classified Meta API error', {
        operation: operationName,
        feature,
        errorKey: metaErrorInfo.errorKey,
        category: metaErrorInfo.category,
        metaErrorCode: metaContext.metaErrorCode,
        metaSubcode: metaContext.metaSubcode,
        metaFbtraceId: metaContext.metaFbtraceId,
      });
    }

    let actionUrl = metaErrorInfo.actionUrl;
    if (metaErrorInfo.errorKey === 'META_TOS_LEAD_GEN' && credentials?.pageId) {
      actionUrl = `https://www.facebook.com/ads/leadgen/tos?page_id=${credentials.pageId}`;
    }

    const errorCode = resolveErrorCode(metaErrorInfo, defaultErrorCode);

    return err(
      new FeatureError(errorCode, metaErrorInfo.userMessage, {
        metaError: {
          ...metaErrorInfo,
          ...(actionUrl ? { actionUrl } : {}),
        },
      })
    );
  }

  // No registry match — unknown error, always log to Sentry
  logError(operationName, error, {
    feature,
    extra: {
      ...extra,
      ...extractMetaErrorContext(cause),
      pgError: cause instanceof Error ? cause.message : undefined,
    },
  });

  return err(
    new FeatureError(defaultErrorCode, `${defaultUserTitle}: ${errorMessage}`, {
      metaError: {
        errorKey: 'META_UNKNOWN_ERROR',
        category: 'unknown' as const,
        userTitle: defaultUserTitle,
        userMessage: errorMessage,
        retryable: false,
      },
    })
  );
}

/**
 * Log a Meta API error only if it's an unknown/unclassified error.
 * Use this in "continue processing" catch blocks (loops, cleanup)
 * where you can't return handleMetaError's Result.
 */
export function logMetaErrorIfUnknown(
  operationName: string,
  error: unknown,
  extra?: Record<string, unknown>,
  feature = 'meta-ads'
): void {
  // appsecret_proof mismatch is a known infrastructure misconfiguration;
  // never log to Sentry from per-org loops to avoid the firehose.
  // TODO: root cause is META_APP_SECRET vs stored token app mismatch.
  if (error instanceof MetaAppSecretMismatchError) {
    return;
  }

  const cause =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  const metaErrorInfo = getMetaErrorInfo(cause) || getMetaErrorInfo(error);

  // Only log unclassified errors to Sentry — known categories are expected
  if (!metaErrorInfo || metaErrorInfo.category === 'unknown') {
    logError(operationName, error, {
      feature,
      extra,
    });
  }
}
