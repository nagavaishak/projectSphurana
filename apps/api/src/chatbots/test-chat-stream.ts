import { openai } from '@ai-sdk/openai';
import { db } from '@borradh-workspace/database';
import { buildTestChatContext } from '@borradh-workspace/features/chatbots';
import type { HttpException, Logger } from '@nestjs/common';
import { type UIMessage, convertToModelMessages, streamText } from 'ai';
import type { Response } from 'express';
import type { TestChatDto } from './dto/test-chat.dto';

/**
 * The two non-transport halves of `POST /chatbots/test-chat`: pulling the
 * user's latest text out of the UI message log, and driving the model stream
 * onto the response.
 *
 * Both were inline in the handler, which is what made it the fattest route in
 * the module at 53 lines — and neither is an HTTP concern. Model id,
 * temperature and token ceiling in particular are product decisions that were
 * sitting in a controller.
 */

/**
 * The text of the most recent `role: 'user'` message, flattened across its
 * text parts. Used as the semantic-search key for voice cloning.
 *
 * Returns `''` when there is no user message or it carries no text parts —
 * `buildTestChatContext` treats empty as "no search key", so an empty log is
 * not an error.
 */
export function latestUserText(messages: TestChatDto['messages']): string {
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === 'user');
  return (
    lastUserMessage?.parts
      ?.filter((p) => p.type === 'text')
      ?.map((p) => String((p as Record<string, unknown>).text ?? ''))
      ?.join('') || ''
  );
}

/**
 * Stream a model reply onto the response in the AI SDK's UI-message protocol.
 *
 * Stream errors are LOGGED, not thrown: headers are already flushed by the
 * time one can happen, so there is no status code left to change. The client
 * sees a truncated stream and the detail lands in the API log.
 */
export async function streamTestChatToResponse(
  res: Response,
  systemPrompt: string,
  messages: TestChatDto['messages'],
  logger: Logger
): Promise<void> {
  const modelMessages = await convertToModelMessages(messages as UIMessage[]);
  const result = streamText({
    model: openai('gpt-4o'),
    system: systemPrompt,
    messages: modelMessages,
    maxOutputTokens: 1000,
    temperature: 0.7,
    onError: ({ error }) => {
      logger.error('Test chat stream error:', error);
    },
  });

  result.pipeUIMessageStreamToResponse(res);
}

/**
 * The whole of `POST /chatbots/test-chat`.
 *
 * NOT an exception-throwing route: every failure is written onto the response
 * as `{ error }` with an explicit status, because the frontend's chat client
 * reads that field. The `mapError` argument is the controller's own mapper —
 * only its STATUS is used, the message comes straight from the error, exactly
 * as the inline version did.
 */
export async function runTestChat(
  res: Response,
  orgId: string | undefined,
  body: TestChatDto,
  logger: Logger,
  mapError: (error: { code: string; message: string }) => HttpException
): Promise<void> {
  if (!orgId) {
    res.status(400).json({ error: 'No active organization selected' });
    return;
  }

  logger.log(
    `test-chat: voiceCloning=${body.voiceCloning}, messages=${body.messages.length}`
  );

  const ctx = await buildTestChatContext(db, {
    organizationId: orgId,
    messageCount: body.messages.length,
    voiceCloning: body.voiceCloning,
    // Latest user text — the semantic-search key for voice cloning.
    userMessage: latestUserText(body.messages),
  });

  if (!ctx.success) {
    res
      .status(mapError(ctx.error).getStatus())
      .json({ error: ctx.error.message });
    return;
  }

  await streamTestChatToResponse(
    res,
    ctx.data.systemPrompt,
    body.messages,
    logger
  );
}
