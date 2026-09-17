import {
  RATE_LIMIT_MESSAGE,
  extractJson,
  initAIClient,
  isAIClientInitialized,
  isRateLimitError,
} from '@borradh-workspace/ai';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getOrgContext } from '../../../shared/org-context.js';
import { getVariationById } from '../../templates/index.js';
import {
  type GenerateVideoScriptInput,
  generateVideoScriptSchema,
} from './generate-video-script.schema.js';
import { buildVideoScriptPrompt } from './prompts.js';

const logger = createLogger('VideoScript');

const scriptOutputSchema = z.object({
  scriptText: z.string().min(1),
});

const generateVideoScriptImpl = async (
  db: DbConnection,
  input: GenerateVideoScriptInput
): Promise<Result<{ scriptText: string }>> => {
  const parsed = generateVideoScriptSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    variationId,
    serviceId,
    narrationMode,
    refinementInstruction,
    priorScriptText,
  } = parsed.data;

  // Look up variation from template definitions
  const match = getVariationById(variationId);
  if (!match) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Template variation not found', {
        variationId,
      })
    );
  }

  // Fetch org context — when serviceId is provided, only that service is included
  const orgContext = await getOrgContext(db, organizationId, serviceId);
  if (!orgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  logger.info('Generating script', {
    variationId,
    narrationMode: narrationMode ?? 'not set (using variation default)',
  });

  // Build prompt and call AI
  const { systemMessage, userMessage } = buildVideoScriptPrompt(
    orgContext,
    match.variation,
    narrationMode,
    { instruction: refinementInstruction, priorScriptText }
  );

  // Ensure AI client is initialized
  if (!isAIClientInitialized()) {
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
  }

  try {
    const result = await extractJson<z.infer<typeof scriptOutputSchema>>(
      userMessage,
      {
        systemMessage,
        schema: scriptOutputSchema,
        temperature: 0.8,
      }
    );

    if (!result.success || !result.data) {
      if (result.error === RATE_LIMIT_MESSAGE) {
        return err(
          new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE)
        );
      }
      logError(
        'videos.generateVideoScript',
        new Error('AI extraction failed'),
        {
          feature: 'videos',
          extra: { variationId, raw: result.raw, error: result.error },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate video script'
        )
      );
    }

    return ok({ scriptText: result.data.scriptText });
  } catch (error) {
    if (isRateLimitError(error)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('videos.generateVideoScript', error, {
      feature: 'videos',
      extra: { organizationId, variationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate video script'
      )
    );
  }
};

export const generateVideoScript = (
  db: DbConnection,
  input: GenerateVideoScriptInput
) =>
  trackedResult(
    'videos.generateVideoScript',
    () => generateVideoScriptImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        variationId: input.variationId,
      },
    }
  );

export type GenerateVideoScriptResult = Awaited<
  ReturnType<typeof generateVideoScript>
>;
