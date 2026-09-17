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
  type GenerateOrganicCopyInput,
  type GeneratedOrganicCopy,
  aestheticLineCopySchema,
  captionTeaseCopySchema,
  clientQuestionCopySchema,
  comeWithMeCopySchema,
  fadeBenefitsCopySchema,
  generateOrganicCopySchema,
  improvesCopySchema,
  insOutsCopySchema,
  mythFactCopySchema,
  numberedListCopySchema,
  pollCopySchema,
  priceRevealCopySchema,
  questionCtaCopySchema,
  stepTimerCopySchema,
  timeProgressCopySchema,
  versusCopySchema,
} from './generate-organic-copy.schema.js';
import { buildOrganicCopyPrompt } from './prompts.js';

const logger = createLogger('OrganicCopy');

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

const generateOrganicCopyImpl = async (
  db: DbConnection,
  input: GenerateOrganicCopyInput
): Promise<Result<GeneratedOrganicCopy>> => {
  const parsed = generateOrganicCopySchema.safeParse(input);
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
    refinementInstruction,
    priorCopy,
  } = parsed.data;

  const orgContext = await getOrgContext(db, organizationId, serviceId);
  if (!orgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const aiInit = await ensureAIClient();
  if (!aiInit.success) return err(aiInit.error);

  const { systemMessage, userMessage } = buildOrganicCopyPrompt(
    orgContext,
    variationId,
    { instruction: refinementInstruction, priorCopy }
  );

  logger.info('Generating organic copy', { variationId, serviceId });

  try {
    // Per-variation: pick the matching output schema + map the response into
    // the discriminated GeneratedOrganicCopy union the controller returns.
    switch (variationId) {
      case 'caption-tease-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: captionTeaseCopySchema,
          temperature: 0.7,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'caption-tease-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        const cfg = result.data;
        return ok({
          kind: 'caption-tease',
          config: {
            headline: cfg.headline,
            // Only keep the emphasis if it actually appears in the headline —
            // the renderer matches it by substring search. Also coerces the
            // model's `null` → undefined.
            emphasis:
              cfg.emphasis && cfg.headline.includes(cfg.emphasis)
                ? cfg.emphasis
                : undefined,
            emoji: cfg.emoji ?? undefined,
            caption: cfg.caption,
          },
        });
      }

      case 'fade-benefits-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: fadeBenefitsCopySchema,
          temperature: 0.7,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'fade-benefits-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'fade-benefits', config: result.data });
      }

      case 'highlight-caption-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: fadeBenefitsCopySchema,
          temperature: 0.7,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'highlight-caption-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'highlight-caption', config: result.data });
      }

      case 'aesthetic-line-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: aestheticLineCopySchema,
          temperature: 0.8,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'aesthetic-line-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'aesthetic-line', config: result.data });
      }

      case 'numbered-list-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: numberedListCopySchema,
          temperature: 0.6,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'numbered-list-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'numbered-list', config: result.data });
      }

      case 'ins-outs-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: insOutsCopySchema,
          temperature: 0.6,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'ins-outs-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({
          kind: 'ins-outs',
          config: {
            ...result.data,
            insLabel: result.data.insLabel ?? undefined,
            outsLabel: result.data.outsLabel ?? undefined,
          },
        });
      }

      case 'question-cta-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: questionCtaCopySchema,
          temperature: 0.7,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'question-cta-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'question-cta', config: result.data });
      }

      case 'curiosity-hook-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: questionCtaCopySchema,
          temperature: 0.8,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'curiosity-hook-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'curiosity-hook', config: result.data });
      }

      case 'improves-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: improvesCopySchema,
          temperature: 0.5,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'improves-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'improves', config: result.data });
      }

      case 'step-timer-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: stepTimerCopySchema,
          temperature: 0.6,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'step-timer-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'step-timer', config: result.data });
      }

      case 'time-progress-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: timeProgressCopySchema,
          temperature: 0.6,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'time-progress-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'time-progress', config: result.data });
      }

      case 'poll-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: pollCopySchema,
          temperature: 0.8,
        });
        if (!result.success || !result.data) {
          return aiFailure('poll-1', result.error, organizationId, result.raw);
        }
        return ok({
          kind: 'poll',
          config: {
            question: result.data.question,
            likeLabel: result.data.likeLabel,
            commentLabel: result.data.commentLabel,
            shareLabel: result.data.shareLabel ?? undefined,
          },
        });
      }

      case 'myth-fact-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: mythFactCopySchema,
          temperature: 0.7,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'myth-fact-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'myth-fact', config: result.data });
      }

      case 'versus-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: versusCopySchema,
          temperature: 0.6,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'versus-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'versus', config: result.data });
      }

      case 'price-reveal-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: priceRevealCopySchema,
          temperature: 0.5,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'price-reveal-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'price-reveal', config: result.data });
      }

      case 'client-question-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: clientQuestionCopySchema,
          temperature: 0.8,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'client-question-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'client-question', config: result.data });
      }

      case 'come-with-me-1': {
        const result = await extractJson(userMessage, {
          systemMessage,
          schema: comeWithMeCopySchema,
          temperature: 0.8,
        });
        if (!result.success || !result.data) {
          return aiFailure(
            'come-with-me-1',
            result.error,
            organizationId,
            result.raw
          );
        }
        return ok({ kind: 'come-with-me', config: result.data });
      }
    }
  } catch (error) {
    if (isRateLimitError(error)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('videos.generateOrganicCopy', error, {
      feature: 'videos',
      extra: { organizationId, variationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate organic video copy'
      )
    );
  }
};

const aiFailure = (
  variationId: string,
  errorMessage: string | undefined,
  organizationId: string,
  raw: string | undefined
): Result<GeneratedOrganicCopy> => {
  if (errorMessage === RATE_LIMIT_MESSAGE) {
    return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
  }
  logError('videos.generateOrganicCopy', new Error('AI extraction failed'), {
    feature: 'videos',
    extra: { variationId, organizationId, raw, error: errorMessage },
  });
  return err(
    new FeatureError(
      ErrorCodes.INTERNAL_ERROR,
      'Failed to generate organic video copy'
    )
  );
};

export const generateOrganicCopy = (
  db: DbConnection,
  input: GenerateOrganicCopyInput
) =>
  trackedResult(
    'videos.generateOrganicCopy',
    () => generateOrganicCopyImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        variationId: input.variationId,
        serviceId: input.serviceId,
      },
    }
  );

export type GenerateOrganicCopyResult = Awaited<
  ReturnType<typeof generateOrganicCopy>
>;
