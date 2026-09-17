import {
  RATE_LIMIT_MESSAGE,
  extractJson,
  initAIClient,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import type { VideoIdea } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getOrgContext } from '../../../shared/org-context.js';
import {
  type GenerateVideoIdeaInput,
  generateVideoIdeaSchema,
  videoIdeaSchema,
} from './generate-video-idea.schema.js';
import { buildVideoIdeaPrompt } from './prompts.js';

const logger = createLogger('VideoIdea');

const ensureAIClient = async (): Promise<Result<void>> => {
  if (isAIClientInitialized()) return ok(undefined);
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'OpenAI API key not configured'
      )
    );
  }
  initAIClient({ apiKey });
  return ok(undefined);
};

const generateVideoIdeaImpl = async (
  db: DbConnection,
  input: GenerateVideoIdeaInput
): Promise<Result<VideoIdea>> => {
  const parsed = generateVideoIdeaSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, templateId, serviceId } = parsed.data;

  // `getOrgContext` narrows to a single service when `serviceId` is provided,
  // so `orgContext.serviceDetails[0]` is the focus service for this slot.
  const orgContext = await getOrgContext(db, organizationId, serviceId);
  if (!orgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const focusService = orgContext.serviceDetails[0];
  if (!focusService) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'Service not found for organization'
      )
    );
  }

  const aiInit = await ensureAIClient();
  if (!aiInit.success) return err(aiInit.error);

  const { systemMessage, userMessage } = buildVideoIdeaPrompt(
    orgContext,
    templateId,
    focusService.name
  );

  logger.info('Generating video idea', {
    templateId,
    serviceId,
    organizationId,
  });

  try {
    const result = await extractJson(userMessage, {
      systemMessage,
      schema: videoIdeaSchema,
      temperature: 0.7,
    });

    if (!result.success || !result.data) {
      if (result.error === RATE_LIMIT_MESSAGE) {
        return err(
          new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE)
        );
      }
      logError('videos.generateVideoIdea', new Error('AI extraction failed'), {
        feature: 'videos',
        extra: {
          templateId,
          serviceId,
          organizationId,
          raw: result.raw,
          error: result.error,
        },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate video idea'
        )
      );
    }

    // Re-stamp `serviceName` from the source-of-truth org service row in case
    // the model rewrote it despite the prompt instruction to copy it verbatim.
    const idea: VideoIdea = {
      topic: result.data.topic,
      angle: result.data.angle,
      payoff: result.data.payoff,
      audience: result.data.audience,
      serviceName: focusService.name,
    };

    return ok(idea);
  } catch (error) {
    if (isRateLimitError(error)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('videos.generateVideoIdea', error, {
      feature: 'videos',
      extra: { organizationId, templateId, serviceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate video idea'
      )
    );
  }
};

export const generateVideoIdea = (
  db: DbConnection,
  input: GenerateVideoIdeaInput
) =>
  trackedResult(
    'videos.generateVideoIdea',
    () => generateVideoIdeaImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        serviceId: input.serviceId,
      },
    }
  );

export type GenerateVideoIdeaResult = Awaited<
  ReturnType<typeof generateVideoIdea>
>;
