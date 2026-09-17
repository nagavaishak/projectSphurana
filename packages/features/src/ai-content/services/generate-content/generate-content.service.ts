import {
  RATE_LIMIT_MESSAGE,
  extractJson,
  getAIClient,
  initAIClient,
  isAIClientInitialized,
  visionCompletion,
} from '@borradh-workspace/ai';
import type {
  JsonExtractionOptions,
  JsonExtractionResult,
} from '@borradh-workspace/ai';
import { asset, organizationService, video } from '@borradh-workspace/database';
import { fetchWithRetry } from '@borradh-workspace/http';
import { businessTypeLabels } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { getContentRuleLines } from '../../../assistant/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { getOrgContext } from '../../../shared/org-context.js';
import type { GeneratedContent } from '../../models/index.js';
import {
  type GenerateContentInput,
  generateContentSchema,
} from './generate-content.schema.js';
import { matchCaptions } from './match-captions.js';
import { buildAdPrompt, buildSocialPostPrompt } from './prompts.js';

// Zod schemas for validating AI output
const adOutputSchema = z.object({
  headline: z.string(),
  primaryText: z.string(),
  description: z.string(),
  callToAction: z.string(),
});

const socialPostOutputSchema = z.object({
  caption: z.string(),
  hashtags: z.array(z.string()),
});

/**
 * Run `extractJson` with one retry on transient failure.
 *
 * Content generation surfaces a single generic 500 ("Failed to generate …")
 * for every underlying cause (see ENG-385 / ENG-377): a model hiccup, an
 * occasional malformed-JSON / schema-validation miss at temperature 0.7, or
 * a real rate limit. A one-shot retry recovers the transient cases that
 * dominate that signal. Rate-limit failures are NOT retried here — the
 * caller maps them to a 429 so the client backs off instead.
 */
async function extractWithRetry<T>(
  userMessage: string,
  options: JsonExtractionOptions<T>
): Promise<JsonExtractionResult<T>> {
  const first = await extractJson<T>(userMessage, options);
  if (first.success || first.error === RATE_LIMIT_MESSAGE) {
    return first;
  }
  return extractJson<T>(userMessage, options);
}

/** True when an `extractJson` failure was an upstream rate limit. */
function isRateLimited(result: { error?: string }): boolean {
  return result.error === RATE_LIMIT_MESSAGE;
}

/**
 * Truncate text at a word boundary to fit within maxLen
 */
function truncateAtWord(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  const truncated = text.slice(0, maxLen);
  const lastSpace = truncated.lastIndexOf(' ');
  return lastSpace > maxLen * 0.5 ? truncated.slice(0, lastSpace) : truncated;
}

/**
 * Clean hashtags: remove # prefix, lowercase, remove spaces
 */
function cleanHashtags(tags: string[]): string[] {
  return tags
    .map((t) => t.replace(/^#/, '').replace(/\s+/g, '').toLowerCase())
    .filter((t) => t.length > 0)
    .slice(0, 10);
}

/**
 * Attempt to transcribe a video using OpenAI Whisper
 */
async function transcribeVideo(blobUrl: string): Promise<string | null> {
  try {
    const client = getAIClient();

    // Fetch the video file
    const response = await fetchWithRetry(blobUrl);
    if (!response.ok) return null;

    const blob = await response.blob();

    // 25MB limit for Whisper API
    if (blob.size > 25 * 1024 * 1024) return null;

    const file = new File([blob], 'audio.mp4', { type: 'video/mp4' });

    const transcription = await client.audio.transcriptions.create({
      model: 'whisper-1',
      file,
    });

    return transcription.text || null;
  } catch {
    return null;
  }
}

/**
 * Get image description via vision completion
 */
async function describeImage(
  blobUrl: string,
  businessType: string
): Promise<string> {
  try {
    const result = await visionCompletion(
      `Describe this image in detail in the context of a ${businessType} business. Focus on what services, treatments, or products are shown. Be concise (2-3 sentences).`,
      [{ url: blobUrl }],
      { maxTokens: 300 }
    );
    return result.content || 'Image content';
  } catch {
    return 'Image content';
  }
}

/**
 * Get media context string from the asset
 */
async function getMediaContext(
  db: DbConnection,
  assetRecord: typeof asset.$inferSelect,
  businessTypeLabel: string
): Promise<string> {
  if (assetRecord.type === 'video') {
    // Try existing transcript first
    if (assetRecord.transcript) {
      return `Video transcript: ${assetRecord.transcript}`;
    }

    // Attempt on-demand transcription
    const transcript = await transcribeVideo(assetRecord.blobUrl);
    if (transcript) {
      // Save transcript back to asset for future use
      try {
        await db
          .update(asset)
          .set({ transcript })
          .where(and(eq(asset.id, assetRecord.id), notDeleted(asset)));
      } catch {
        // Non-critical, continue
      }
      return `Video transcript: ${transcript}`;
    }

    // Fallback: use asset name/tags as context
    return `Video titled "${assetRecord.name}"${assetRecord.tags.length > 0 ? ` tagged with: ${assetRecord.tags.join(', ')}` : ''} for a ${businessTypeLabel} business`;
  }

  // Image: use vision API
  const description = await describeImage(
    assetRecord.blobUrl,
    businessTypeLabel
  );
  return `Image description: ${description}`;
}

/**
 * Internal implementation
 */
const generateContentImpl = async (
  db: DbConnection,
  input: GenerateContentInput,
  apiKey: string
): Promise<Result<GeneratedContent>> => {
  // Initialize AI client if needed
  if (!isAIClientInitialized()) {
    initAIClient({ apiKey });
  }

  // Validate input
  const parsed = generateContentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    mediaId,
    mediaType,
    contentType,
    platform,
    serviceIds,
    includeOffer,
  } = parsed.data;

  // Fetch org context
  const baseOrgContext = await getOrgContext(db, organizationId);
  if (!baseOrgContext) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // Standing content rules the owner taught us during review. Attached here
  // rather than inside `getOrgContext` because that module is the extractable
  // stable core and must not reach into a feature domain — see the field's
  // note on `OrgContext`.
  const orgContext = {
    ...baseOrgContext,
    contentRules: await getContentRuleLines(db, organizationId),
  };

  // For ads with selected services, try master captions first
  if (contentType === 'ad' && serviceIds && serviceIds.length > 0) {
    const matched = await matchCaptions(
      db,
      serviceIds,
      orgContext.credibilityLine
    );

    if (matched) {
      return ok({
        contentType: 'ad',
        content: {
          headline: matched.headline,
          primaryText: matched.primaryText,
          description: '',
          callToAction: 'CONTACT_US',
        },
      });
    }
  }

  const businessTypeLabel =
    businessTypeLabels[orgContext.businessType] || orgContext.businessType;

  // Try video table first when mediaType is 'video'
  let mediaContext: string | null = null;

  if (mediaType === 'video') {
    const videoRecord = await db.query.video.findFirst({
      where: and(
        eq(video.id, mediaId),
        eq(video.organizationId, organizationId),
        notDeleted(video)
      ),
    });

    if (videoRecord) {
      const draftConfig = (videoRecord.draftConfig ?? {}) as Record<
        string,
        unknown
      >;
      const transcript =
        (typeof draftConfig.transcriptText === 'string' &&
          draftConfig.transcriptText) ||
        (typeof draftConfig.scriptText === 'string' &&
          draftConfig.scriptText) ||
        null;

      if (transcript) {
        mediaContext = `Video transcript: ${transcript}`;
      } else if (videoRecord.blobUrl) {
        const transcribed = await transcribeVideo(videoRecord.blobUrl);
        if (transcribed) {
          mediaContext = `Video transcript: ${transcribed}`;
        }
      }

      // Drafts (including text-only offer videos) do not have a blob URL yet.
      // They are still valid caption targets: use the on-video copy and title
      // instead of falling through to the asset table, where the video ID can
      // never resolve and caption generation fails with "Asset not found".
      if (!mediaContext) {
        const offerCard = draftConfig.offerCard as
          | Record<string, unknown>
          | undefined;
        const offerText = offerCard
          ? [
              offerCard.headline,
              ...(Array.isArray(offerCard.bulletPoints)
                ? offerCard.bulletPoints
                : []),
              offerCard.ctaText,
            ]
              .filter((value): value is string => typeof value === 'string')
              .join(' — ')
          : '';
        mediaContext = [
          `Video titled "${videoRecord.title}" for a ${businessTypeLabel} business`,
          offerText ? `On-video copy: ${offerText}` : '',
        ]
          .filter(Boolean)
          .join('. ');
      }
    }
  }

  // Fall back to asset table
  if (!mediaContext) {
    const assetRecord = await db.query.asset.findFirst({
      where: and(
        eq(asset.id, mediaId),
        eq(asset.organizationId, organizationId),
        notDeleted(asset)
      ),
    });

    if (!assetRecord) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found', { mediaId })
      );
    }

    mediaContext = await getMediaContext(db, assetRecord, businessTypeLabel);
  }

  // Generate content based on type
  if (contentType === 'ad') {
    // Resolve service names for the AI prompt
    let serviceNames: string[] | undefined;
    if (serviceIds && serviceIds.length > 0) {
      const services = await db
        .select({ id: organizationService.id, name: organizationService.name })
        .from(organizationService)
        .where(inArray(organizationService.id, serviceIds));
      // Preserve user's selection order
      serviceNames = serviceIds
        .map((id) => services.find((s) => s.id === id)?.name)
        .filter((n): n is string => n != null);
    }

    const { systemMessage, userMessage } = buildAdPrompt(
      orgContext,
      mediaContext,
      platform,
      serviceNames,
      includeOffer
    );

    const result = await extractWithRetry<z.infer<typeof adOutputSchema>>(
      userMessage,
      {
        systemMessage,
        schema: adOutputSchema,
        temperature: 0.7,
      }
    );

    if (!result.success || !result.data) {
      if (isRateLimited(result)) {
        return err(
          new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE)
        );
      }
      logError('aiContent.generateContent', new Error('AI extraction failed'), {
        feature: 'ai-content',
        extra: { contentType, raw: result.raw, error: result.error },
      });
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to generate ad content'
        )
      );
    }

    const data = result.data;

    return ok({
      contentType: 'ad',
      content: {
        headline: truncateAtWord(data.headline, 80),
        primaryText: truncateAtWord(data.primaryText, 500),
        description: truncateAtWord(data.description, 30),
        callToAction: data.callToAction,
      },
    });
  }

  // Social post
  const { systemMessage, userMessage } = buildSocialPostPrompt(
    orgContext,
    mediaContext,
    platform
  );

  const result = await extractWithRetry<z.infer<typeof socialPostOutputSchema>>(
    userMessage,
    {
      systemMessage,
      schema: socialPostOutputSchema,
      temperature: 0.7,
    }
  );

  if (!result.success || !result.data) {
    if (isRateLimited(result)) {
      return err(new FeatureError(ErrorCodes.RATE_LIMITED, RATE_LIMIT_MESSAGE));
    }
    logError('aiContent.generateContent', new Error('AI extraction failed'), {
      feature: 'ai-content',
      extra: { contentType, raw: result.raw, error: result.error },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate social post content'
      )
    );
  }

  const data = result.data;

  return ok({
    contentType: 'social-post',
    content: {
      caption: data.caption,
      hashtags: cleanHashtags(data.hashtags),
    },
  });
};

/**
 * Generate AI content (ad copy or social post) based on media and business context
 */
export const generateContent = (
  db: DbConnection,
  input: GenerateContentInput,
  apiKey: string
) =>
  trackedResult(
    'aiContent.generateContent',
    () => generateContentImpl(db, input, apiKey),
    {
      properties: {
        organizationId: input.organizationId,
        mediaId: input.mediaId,
        contentType: input.contentType,
      },
    }
  );

export type GenerateContentResult = Awaited<ReturnType<typeof generateContent>>;
