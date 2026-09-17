import { fetchWithTimeout } from '@borradh-workspace/http';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SendIntercomMessageInput,
  sendIntercomMessageSchema,
} from './send-intercom-message.schema.js';

const INTERCOM_API_URL = 'https://api.intercom.io/messages';

interface SendIntercomMessageResult {
  sent: boolean;
  reason?: string;
}

const sendIntercomMessageImpl = async (
  input: SendIntercomMessageInput,
  config: { accessToken?: string; adminId?: string }
): Promise<Result<SendIntercomMessageResult>> => {
  const parsed = sendIntercomMessageSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { accessToken, adminId } = config;
  if (!accessToken || !adminId) {
    return ok({ sent: false, reason: 'not_configured' });
  }

  const { userId, messageBody } = parsed.data;

  try {
    const response = await fetchWithTimeout(INTERCOM_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        message_type: 'inapp',
        from: { type: 'admin', id: adminId },
        to: { type: 'user', external_id: userId },
        body: messageBody,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logError('notifications.sendIntercomMessage', new Error(body), {
        feature: 'notifications',
        extra: { userId, status: response.status },
      });
      return ok({ sent: false, reason: `http_${response.status}` });
    }

    return ok({ sent: true });
  } catch (error) {
    logError('notifications.sendIntercomMessage', error, {
      feature: 'notifications',
      extra: { userId },
    });
    return ok({ sent: false, reason: 'fetch_error' });
  }
};

export const sendIntercomMessage = (
  input: SendIntercomMessageInput,
  config: { accessToken?: string; adminId?: string }
) =>
  trackedResult(
    'notifications.sendIntercomMessage',
    () => sendIntercomMessageImpl(input, config),
    { properties: { userId: input.userId } }
  );

export type SendIntercomMessageServiceResult = Awaited<
  ReturnType<typeof sendIntercomMessage>
>;
