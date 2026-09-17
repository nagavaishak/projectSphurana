import { db, withSystemScope } from '@borradh-workspace/database';
import { voiceEnv } from '@borradh-workspace/env/voice';
import {
  handleVoiceToolCall,
  handleVoiceWebhook,
} from '@borradh-workspace/features/voice';
import { HttpException, HttpStatus, type Logger } from '@nestjs/common';
import { webhookHttpError } from '../webhook-http-error.js';

/**
 * Orchestration for the two Telnyx webhooks. Everything the handlers did after
 * `TelnyxPayloadGuard` / `TelnyxSignatureGuard` had run.
 */

interface TelnyxRequest {
  rawBody: string;
  signature: string;
  timestamp: string;
  logger: Logger;
}

export async function dispatchTelnyxWebhook({
  rawBody,
  signature,
  timestamp,
  logger,
}: TelnyxRequest): Promise<{
  success: true;
  event: string;
  callControlId: string;
}> {
  const result = await withSystemScope(
    (conn) =>
      handleVoiceWebhook(
        conn,
        { payload: rawBody, signature, timestamp },
        // TelnyxPayloadGuard has already rejected an unset key with 500.
        voiceEnv.TELNYX_WEBHOOK_PUBLIC_KEY as string
      ),
    { db }
  );

  if (!result.success) {
    throw webhookHttpError(result.error);
  }

  logger.log(
    `Webhook processed: event=${result.data.event}, callControlId=${result.data.callControlId}, outcome=${result.data.outcome ?? 'n/a'}`
  );

  return {
    success: true,
    event: result.data.event,
    callControlId: result.data.callControlId,
  };
}

interface TelnyxToolCall {
  tool_call_id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
  conversation_id: string;
  assistant_id: string;
}

export async function dispatchTelnyxToolCall({
  rawBody,
  logger,
}: {
  rawBody: string;
  logger: Logger;
}): Promise<unknown> {
  let toolCall: TelnyxToolCall;
  try {
    toolCall = JSON.parse(rawBody);
  } catch {
    throw new HttpException('Invalid JSON payload', HttpStatus.BAD_REQUEST);
  }

  logger.log(
    `Tool call: ${toolCall.tool_name} for conversation ${toolCall.conversation_id}`
  );

  const result = await withSystemScope(
    (conn) =>
      handleVoiceToolCall(conn, {
        conversation_id: toolCall.conversation_id,
        tool_call_id: toolCall.tool_call_id,
        tool_name: toolCall.tool_name,
        arguments: toolCall.arguments,
      }),
    { db }
  );

  if (!result.success) {
    throw webhookHttpError(result.error);
  }

  logger.log(
    `Tool call completed: ${toolCall.tool_name} for conversation ${toolCall.conversation_id}`
  );

  return result.data;
}
