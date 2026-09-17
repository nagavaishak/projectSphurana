import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { organization } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type AnalyzeStyleInput,
  analyzeStyleSchema,
} from './analyze-style.schema.js';
import { STYLE_ANALYSIS_PROMPT } from './style-analysis-prompt.js';

const logger = createLogger('AnalyzeStyle');

const AI_MAX_TOKENS = 2000;

const analyzeStyleImpl = async (
  db: DbConnection,
  input: AnalyzeStyleInput
): Promise<Result<string>> => {
  const parsed = analyzeStyleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, messages } = parsed.data;

  // Ensure AI client is initialized
  if (!isAIClientInitialized()) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'OPENAI_API_KEY not set — cannot analyze style'
        )
      );
    }
    initAIClient({ apiKey });
  }

  // Build the prompt with numbered messages
  const numberedMessages = messages
    .map((msg, i) => `${i + 1}. "${msg}"`)
    .join('\n');
  const prompt = `${STYLE_ANALYSIS_PROMPT}${numberedMessages}`;

  try {
    const result = await chatCompletion(prompt, {
      temperature: 0.5,
      maxTokens: AI_MAX_TOKENS,
    });

    const styleProfile = result.content.trim();

    if (!styleProfile) {
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'AI returned empty style analysis'
        )
      );
    }

    // Store the result on the organization
    await db
      .update(organization)
      .set({
        voiceStyleProfile: styleProfile,
        voiceStyleProfileUpdatedAt: new Date(),
      })
      .where(
        and(eq(organization.id, organizationId), notDeleted(organization))
      );

    logger.info('Style analysis completed', {
      organizationId,
      messageCount: messages.length,
      profileLength: styleProfile.length,
    });

    return ok(styleProfile);
  } catch (error) {
    logError('voiceCloning.analyzeStyle', error, {
      feature: 'voice-cloning',
      extra: { organizationId, messageCount: messages.length },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to analyze communication style'
      )
    );
  }
};

export const analyzeStyle = (db: DbConnection, input: AnalyzeStyleInput) =>
  trackedResult(
    'voiceCloning.analyzeStyle',
    () => analyzeStyleImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        messageCount: input.messages.length,
      },
    }
  );

export type AnalyzeStyleResult = Awaited<ReturnType<typeof analyzeStyle>>;
