import {
  Body,
  Controller,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
} from '../common/index.js';
import {
  type PromptConfigResponse,
  buildPromptConfig,
} from './chat/build-prompt-config.js';
import {
  type PromptPreviewBody,
  buildPromptPreview,
} from './chat/build-prompt-preview.js';
import {
  type AssistantChatBody,
  STREAM_TIMEOUT_MS,
  planAssistantChatTurn,
} from './chat/plan-chat-turn.js';
import { respondWithUIStream } from './lib/respond-ui-stream.js';

export type { PromptOverrides } from './chat/prompt-overrides.js';

/**
 * Streaming chat controller for Claire.
 *
 * Transport only. Every decision about a turn — prompt assembly, tool
 * catalogue, conversation resolution, the tool loop, persistence, title
 * generation and error mapping — lives in `./chat/`. What remains here is the
 * three things a controller is allowed to do: set the socket timeout, hand the
 * request to a use case, and write the result to the wire.
 *
 * The SSE framing itself (headers, `data:` frames, the `[DONE]` terminator)
 * lives in `./lib/respond-ui-stream.ts`; the use case returns a plan of
 * already-decided events and never sees the `Response`.
 */
@Controller('assistant')
@UseGuards(AuthGuard)
export class AssistantChatController {
  private readonly logger = new Logger(AssistantChatController.name);

  @Post('chat')
  async chat(
    @Body() body: AssistantChatBody,
    @ActiveOrganization() organizationId: string,
    @ActiveLocation() locationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res() res: Response
  ): Promise<void> {
    res.setTimeout(STREAM_TIMEOUT_MS);
    const plan = await planAssistantChatTurn({
      body,
      organizationId,
      userId,
      cookie: req.headers.cookie ?? '',
      authorization: req.headers.authorization,
      // The branch the user is in. Every loopback tool hop inherits it, so
      // Claire quotes THIS branch's prices — see plan §3.3.
      locationId,
      logger: this.logger,
    });
    await respondWithUIStream(res, plan);
  }

  /** Local prompt-inspector endpoint (uncommitted dev tool). */
  @Post('prompt-preview')
  async promptPreview(
    @Body() body: PromptPreviewBody,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string,
    @Res() res: Response
  ): Promise<void> {
    const result = await buildPromptPreview({ body, organizationId, userId });
    res.status(result.status).json(result.body);
  }

  /** Local prompt-tuning config endpoint (uncommitted dev tool). */
  @Post('prompt-config')
  async promptConfig(
    @Body() body: { conversationId?: string },
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ): Promise<PromptConfigResponse> {
    return buildPromptConfig({
      organizationId,
      userId,
      conversationId: body.conversationId,
      logger: this.logger,
    });
  }
}
