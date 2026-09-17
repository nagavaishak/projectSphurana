import { randomUUID } from 'node:crypto';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { createLogger } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type HandleMetaDeletionCallbackInput,
  handleMetaDeletionCallbackSchema,
} from './handle-meta-deletion-callback.schema.js';

const logger = createLogger('MetaDeletionCallback');

interface MetaDeletionCallbackResult {
  url: string;
  confirmationCode: string;
}

/**
 * Parse and verify Meta's signed_request parameter.
 *
 * The signed_request is a base64url-encoded payload with an HMAC-SHA256
 * signature, separated by a period: `{signature}.{payload}`
 *
 * @see https://developers.facebook.com/docs/games/gamesonfacebook/login#parsingsr
 */
async function parseSignedRequest(
  signedRequest: string,
  appSecret: string
): Promise<Result<{ userId: string; issuedAt: number }>> {
  const parts = signedRequest.split('.');
  if (parts.length !== 2) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid signed_request format'
      )
    );
  }

  const [encodedSignature, encodedPayload] = parts;

  // Verify HMAC-SHA256 signature
  const crypto = await import('node:crypto');
  const expectedSignature = crypto
    .createHmac('sha256', appSecret)
    .update(encodedPayload)
    .digest('base64url');

  if (encodedSignature !== expectedSignature) {
    return err(
      new FeatureError(
        ErrorCodes.UNAUTHORIZED,
        'Invalid signed_request signature'
      )
    );
  }

  // Decode payload
  try {
    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString(
      'utf-8'
    );
    const payload = JSON.parse(payloadJson) as {
      user_id?: string;
      issued_at?: number;
    };

    if (!payload.user_id) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'Missing user_id in signed_request payload'
        )
      );
    }

    return ok({
      userId: payload.user_id,
      issuedAt: payload.issued_at ?? Math.floor(Date.now() / 1000),
    });
  } catch {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Failed to decode signed_request payload'
      )
    );
  }
}

/**
 * Internal implementation of handle Meta data deletion callback.
 *
 * This handles the simplified/pragmatic approach:
 * 1. Verify the signed_request
 * 2. Log the Facebook user_id for audit trail
 * 3. Return a confirmation URL pointing to /data-deletion?code=<uuid>
 *
 * The actual data disconnection is handled via the existing manual process
 * (email to privacy@borradh.io) since we cannot reliably match Meta's
 * user_id to our internal organization records.
 */
const handleMetaDeletionCallbackImpl = async (
  input: HandleMetaDeletionCallbackInput
): Promise<Result<MetaDeletionCallbackResult>> => {
  const parsed = handleMetaDeletionCallbackSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { signedRequest, appSecret, dataDeletionUrl } = parsed.data;

  try {
    // Parse and verify the signed request
    const parseResult = await parseSignedRequest(signedRequest, appSecret);
    if (!parseResult.success) {
      return parseResult;
    }

    const { userId: metaUserId, issuedAt } = parseResult.data;

    // Generate a unique confirmation code
    const confirmationCode = randomUUID();

    // Log for audit trail
    logger.info('Meta data deletion callback received', {
      metaUserId,
      issuedAt,
      confirmationCode,
    });

    // Build the status check URL
    const url = `${dataDeletionUrl}?code=${confirmationCode}`;

    return ok({ url, confirmationCode });
  } catch (error) {
    logError('integrations.handleMetaDeletionCallback', error, {
      feature: 'integrations',
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to process data deletion callback'
      )
    );
  }
};

/**
 * Handle Meta's data deletion callback
 *
 * When a user removes the app from Facebook settings, Meta POSTs a
 * `signed_request`. This verifies the signature and returns the
 * required `{ url, confirmation_code }` response.
 *
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export const handleMetaDeletionCallback = (
  input: HandleMetaDeletionCallbackInput
) =>
  trackedResult(
    'integrations.handleMetaDeletionCallback',
    () => handleMetaDeletionCallbackImpl(input),
    { properties: { hasSignedRequest: !!input.signedRequest } }
  );

export type HandleMetaDeletionCallbackResult = Awaited<
  ReturnType<typeof handleMetaDeletionCallback>
>;
