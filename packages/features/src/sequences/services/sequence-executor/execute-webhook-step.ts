import { createLogger } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { interpolateMessage } from './interpolate-message.js';
import type {
  ExecutionResultData,
  LeadData,
  SequenceStep,
  WebhookNodeConfig,
} from './types.js';

const logger = createLogger('SequenceExecutor');

/**
 * Execute a webhook step
 */
export async function executeWebhookStep(
  _db: DbConnection,
  leadData: LeadData,
  step: SequenceStep,
  _organizationId: string
): Promise<Result<ExecutionResultData>> {
  const webhookConfig = step.config as unknown as WebhookNodeConfig;

  // Validate URL exists
  if (!webhookConfig.url) {
    return err(
      new FeatureError(ErrorCodes.INVALID_INPUT, 'Webhook step is missing URL')
    );
  }

  // Validate URL format
  try {
    new URL(webhookConfig.url);
  } catch {
    return err(
      new FeatureError(ErrorCodes.INVALID_INPUT, 'Webhook URL is invalid')
    );
  }

  const method = webhookConfig.method ?? 'POST';
  const timeoutMs = webhookConfig.timeoutMs ?? 30000;

  // Prepare request body with lead data interpolation
  let requestBody: string | undefined;
  if (webhookConfig.body && method !== 'GET') {
    try {
      // Parse the body template to interpolate lead data
      const bodyTemplate = webhookConfig.body;
      requestBody = interpolateMessage(bodyTemplate, leadData);
      // Validate it's valid JSON
      JSON.parse(requestBody);
    } catch {
      // If body isn't valid JSON after interpolation, send as-is
      requestBody = webhookConfig.body;
    }
  }

  // Default payload for POST/PUT if no body specified
  if (!requestBody && (method === 'POST' || method === 'PUT')) {
    requestBody = JSON.stringify({
      leadId: leadData.id,
      firstName: leadData.firstName,
      lastName: leadData.lastName,
      email: leadData.email,
      phone: leadData.phone,
      status: leadData.status,
      timestamp: new Date().toISOString(),
    });
  }

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Borradh-Sequence-Executor/1.0',
    ...webhookConfig.headers,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(webhookConfig.url, {
      method,
      headers,
      body: method !== 'GET' ? requestBody : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseStatus = response.status;
    const responseOk = response.ok;

    logger.info('Webhook called', {
      leadId: leadData.id,
      url: webhookConfig.url,
      method,
      status: responseStatus,
      success: responseOk,
    });

    if (!responseOk) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          `Webhook returned status ${responseStatus}`
        )
      );
    }

    return ok({
      type: 'webhook',
      called: true,
      messageId: `webhook-${Date.now()}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Webhook call failed', {
      leadId: leadData.id,
      url: webhookConfig.url,
      error: message,
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Webhook call failed: ${message}`
      )
    );
  }
}
