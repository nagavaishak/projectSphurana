import {
  extractJson,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
import {
  type GenerateOfferContentInput,
  generateOfferContentSchema,
} from './generate-offer-content.schema.js';
import {
  buildOfferContentSystemPrompt,
  buildOfferContentUserPrompt,
} from './prompts.js';

/**
 * Output shape for generated offer content
 */
export interface GeneratedOfferContent {
  headline: string;
  bulletPoints: string[];
}

const offerOutputSchema = z.object({
  headline: z.string().min(1),
  bulletPoints: z.array(z.string().min(1)).min(1).max(4),
});

/**
 * Generate offer card content (headline + bullet points) using AI.
 *
 * Uses the organization's service details (painPoints, expectedResults, etc.)
 * to generate relevant, benefit-focused content for the square offer video format.
 */
const generateOfferContentImpl = async (
  db: DbConnection,
  input: GenerateOfferContentInput,
  apiKey: string
): Promise<Result<GeneratedOfferContent>> => {
  // Initialize AI client if needed
  if (!isAIClientInitialized()) {
    initAIClient({ apiKey });
  }

  const parsed = generateOfferContentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, headline } = parsed.data;

  // Fetch org context — when serviceId is provided, focuses on that service;
  // otherwise fetches all org services for broader context
  const orgContext = await getOrgContext(db, organizationId, serviceId);
  if (!orgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const serviceDetail = orgContext.serviceDetails[0];

  try {
    const systemMessage = buildOfferContentSystemPrompt();
    const userMessage = buildOfferContentUserPrompt(
      orgContext,
      serviceDetail?.name,
      serviceDetail,
      headline
    );

    const result = await extractJson<z.infer<typeof offerOutputSchema>>(
      userMessage,
      {
        systemMessage,
        schema: offerOutputSchema,
        temperature: 0.7,
      }
    );

    if (!result.success || !result.data) {
      logError(
        'aiContent.generateOfferContent',
        new Error('AI extraction failed'),
        {
          feature: 'ai-content',
          extra: { organizationId, serviceId, raw: result.raw },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate offer content'
        )
      );
    }

    return ok({
      headline: result.data.headline,
      bulletPoints: result.data.bulletPoints,
    });
  } catch (error) {
    logError('aiContent.generateOfferContent', error, {
      feature: 'ai-content',
      extra: { organizationId, serviceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate offer content'
      )
    );
  }
};

export const generateOfferContent = (
  db: DbConnection,
  input: GenerateOfferContentInput,
  apiKey: string
) =>
  trackedResult(
    'aiContent.generateOfferContent',
    () => generateOfferContentImpl(db, input, apiKey),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type GenerateOfferContentResult = Awaited<
  ReturnType<typeof generateOfferContent>
>;
