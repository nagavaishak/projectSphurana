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
import { getContentRuleLines } from '../../../assistant/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { loadCaptionSamples } from './caption-samples.js';
import {
  type GeneratePostCaptionInput,
  type GeneratedPostCaption,
  generatePostCaptionSchema,
  postCaptionOutputSchema,
} from './generate-post-caption.schema.js';
import { buildPostCaptionPrompt } from './prompts.js';

const logger = createLogger('PostCaption');

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

/**
 * Generate the long-form Facebook/Instagram caption for one slot of the
 * organic content planner. Runs in parallel with `generateOrganicCopy` off
 * the same `VideoIdea` so the on-screen video copy and the caption tell one
 * coherent story.
 *
 * The DB connection is used for exactly one read: the org's standing content
 * rules. Everything else the prompt needs already lives on `input.idea` (the
 * planner step that produced the idea resolved service + org details, and
 * re-fetching those here would be a wasted round-trip during fan-out).
 *
 * The rules are read HERE rather than threaded in by callers on purpose. There
 * are three call sites (the monthly batch, `planVideoDetail`, and a Claire
 * tool) and more will follow; a caller that forgets to pass them produces copy
 * that quietly ignores what the owner explicitly taught us, which is the one
 * failure that would make the whole feature untrustworthy. One small indexed
 * SELECT next to a GPT-4o call is a price worth paying for correct-by-default.
 */
const generatePostCaptionImpl = async (
  db: DbConnection,
  input: GeneratePostCaptionInput
): Promise<Result<GeneratedPostCaption>> => {
  const parsed = generatePostCaptionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, idea, brandVoice } = parsed.data;

  const aiInit = await ensureAIClient();
  if (!aiInit.success) return err(aiInit.error);

  const contentRules = await getContentRuleLines(db, organizationId);
  // Best-effort: an org with no corpus yet simply falls back to the described
  // voice, which is what every org used to get.
  const samples = await loadCaptionSamples(db, organizationId).catch(() => ({
    captions: [],
    averageHashtagCount: null,
    averageLength: null,
  }));

  const { systemMessage, userMessage } = buildPostCaptionPrompt(
    idea,
    brandVoice,
    contentRules,
    samples
  );

  logger.info('Generating post caption', {
    organizationId,
    topic: idea.topic,
    serviceName: idea.serviceName,
    // Zero means this caption is written from the generic voice description
    // rather than from the business's own writing.
    captionSamples: samples.captions.length,
    averageHashtagCount: samples.averageHashtagCount,
  });

  try {
    let result = await extractJson(userMessage, {
      systemMessage,
      schema: postCaptionOutputSchema,
      // Caption is the creative surface — slightly hotter than idea generation
      // (0.7) so the prose has some texture.
      temperature: 0.75,
    });

    // ONE RETRY, WITH THE MEASUREMENT FED BACK.
    //
    // A schema failure here is fatal to the whole item: `dispatchMonthlyPlan`
    // drops the planned video, so a caption that runs long costs a video whose
    // b-roll was already resolved and whose render was ready. One org lost all
    // three of its videos for the month that way.
    //
    // Re-asking identically re-samples the same distribution, and every
    // observed failure was the same shape — too long, by 40 to 258 characters.
    // So the retry TELLS THE MODEL WHAT IT DID: the length it produced and the
    // limit it has. Rate limits are not retried; that is a different failure
    // and the caller handles it.
    if (!result.success && result.error !== RATE_LIMIT_MESSAGE) {
      const overshot = typeof result.raw === 'string' ? result.raw.length : 0;
      logger.warn('Caption failed its schema — retrying once', {
        organizationId,
        topic: idea.topic,
        rawLength: overshot,
        error: result.error,
      });
      result = await extractJson(
        `${userMessage}\n\nYour previous attempt was REJECTED because the caption was the wrong length${
          overshot ? ` (about ${overshot} characters)` : ''
        }. It must be between 80 and 1200 characters. Write a shorter caption — cut the body, not the hook or the hashtags.`,
        {
          systemMessage,
          schema: postCaptionOutputSchema,
          // Cooler on the retry: this attempt needs to comply, not to be
          // interesting.
          temperature: 0.4,
        }
      );
    }

    if (!result.success || !result.data) {
      if (result.error === RATE_LIMIT_MESSAGE) {
        return err(
          new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE)
        );
      }
      logError(
        'socialPosts.generatePostCaption',
        new Error('AI extraction failed'),
        {
          feature: 'social-posts',
          extra: {
            organizationId,
            topic: idea.topic,
            raw: result.raw,
            error: result.error,
          },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate post caption'
        )
      );
    }

    return ok({ caption: result.data.caption });
  } catch (error) {
    if (isRateLimitError(error)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('socialPosts.generatePostCaption', error, {
      feature: 'social-posts',
      extra: { organizationId, topic: idea.topic },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate post caption'
      )
    );
  }
};

export const generatePostCaption = (
  db: DbConnection,
  input: GeneratePostCaptionInput
) =>
  trackedResult(
    'socialPosts.generatePostCaption',
    () => generatePostCaptionImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        topic: input.idea.topic,
      },
    }
  );

export type GeneratePostCaptionResult = Awaited<
  ReturnType<typeof generatePostCaption>
>;
