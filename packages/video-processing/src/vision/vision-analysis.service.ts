/**
 * OpenAI GPT-4 Vision Analysis Service
 *
 * Analyzes video frames to:
 * 1. Classify content type (procedure, testimonial, b-roll, etc.)
 * 2. Match to organization services
 * 3. Generate descriptive tags
 */

import * as fs from 'node:fs';
import type { AssetContentType } from '@borradh-workspace/database';
import OpenAI from 'openai';
import type { FrameWithTimestamp } from '../ffmpeg/types.js';
import type {
  ActionSegment,
  ActionSegmentLabel,
  VideoAnalysisContext,
  VisionAnalysisResult,
  VisionApiConfig,
  VisionApiResponse,
  VisionModel,
} from './types.js';

let config: VisionApiConfig | null = null;
let client: OpenAI | null = null;

/**
 * Error thrown when the Vision API returns no usable text content after all
 * retries. Distinct from transient/network failures so callers can choose to
 * skip the asset rather than treat it as a retriable infra error.
 */
export class EmptyVisionResponseError extends Error {
  constructor(message = 'No response content from Vision API') {
    super(message);
    this.name = 'EmptyVisionResponseError';
  }
}

const VISION_MAX_RETRIES = 2;

/**
 * Base backoff between retries in ms (default 1s, then 2s). Read at call time
 * (not module load) and overridable via env so tests can run instantly.
 */
function getRetryBaseDelayMs(): number {
  return Number.parseInt(process.env.VISION_RETRY_BASE_DELAY_MS || '1000', 10);
}

/**
 * Sleep helper for backoff between retries.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether an error from the OpenAI SDK is worth retrying. Covers rate limits
 * (429), server errors (5xx), and connection/timeout failures. Permanent
 * client errors (e.g. 400 invalid image) are NOT retried.
 */
function isTransientVisionError(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') {
    return status === 429 || status >= 500;
  }
  // APIConnectionError / APIConnectionTimeoutError have no status code.
  const name = (error as { name?: string })?.name ?? '';
  return (
    name.includes('Connection') ||
    name.includes('Timeout') ||
    name === 'APIConnectionError'
  );
}

/**
 * Call the Vision API and return the text content, retrying with exponential
 * backoff when the response has no usable content or the call fails with a
 * transient error.
 *
 * Empty content happens when the model refuses, the response is filtered, or
 * `max_tokens` truncates output before any JSON is emitted (`finish_reason ===
 * 'length'`). For the truncation case we bump `max_tokens` on the next attempt.
 *
 * @throws EmptyVisionResponseError if no content is produced after all retries
 */
async function createVisionCompletion(
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
  verbose = false
): Promise<string> {
  if (!client) {
    throw new Error('Vision API not initialized. Call initVisionApi first.');
  }

  let lastError: unknown;
  let maxTokens = params.max_tokens ?? undefined;

  for (let attempt = 0; attempt <= VISION_MAX_RETRIES; attempt++) {
    try {
      const response = await client.chat.completions.create({
        ...params,
        ...(maxTokens ? { max_tokens: maxTokens } : {}),
      });

      const choice = response.choices[0];
      const content = choice?.message?.content;
      const finishReason = choice?.finish_reason;

      if (content) {
        return content;
      }

      // Empty content. If we were truncated by the token budget, retry with a
      // larger budget; otherwise it's a refusal/filter — retrying may still
      // succeed on a transient filter flake, so we retry a couple of times.
      lastError = new EmptyVisionResponseError(
        `No response content from Vision API (finish_reason: ${finishReason ?? 'unknown'})`
      );

      if (finishReason === 'length' && maxTokens) {
        maxTokens = Math.min(maxTokens * 2, 4096);
      }

      if (verbose) {
        console.log(
          `[vision-api] Empty response (finish_reason: ${finishReason ?? 'unknown'}), attempt ${attempt + 1}/${VISION_MAX_RETRIES + 1}`
        );
      }
    } catch (error) {
      lastError = error;

      if (!isTransientVisionError(error)) {
        throw error;
      }

      if (verbose) {
        console.log(
          `[vision-api] Transient error, attempt ${attempt + 1}/${VISION_MAX_RETRIES + 1}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // Back off before the next attempt (no delay after the final attempt).
    if (attempt < VISION_MAX_RETRIES) {
      await delay(getRetryBaseDelayMs() * 2 ** attempt);
    }
  }

  if (lastError instanceof EmptyVisionResponseError) {
    throw lastError;
  }
  throw lastError instanceof Error ? lastError : new EmptyVisionResponseError();
}

/**
 * Initialize the Vision API client
 */
export function initVisionApi(apiConfig: VisionApiConfig): void {
  config = apiConfig;
  client = new OpenAI({
    apiKey: apiConfig.apiKey,
  });
}

/**
 * Get the current Vision API configuration
 */
export function getVisionApiConfig(): VisionApiConfig | null {
  return config;
}

/**
 * Check if the Vision API is initialized
 */
export function isVisionApiInitialized(): boolean {
  return client !== null && config !== null;
}

/**
 * Build the analysis prompt for GPT-4 Vision
 */
function buildAnalysisPrompt(
  context: VideoAnalysisContext,
  mediaType: 'video' | 'image' = 'video'
): string {
  const servicesList =
    context.organizationServices.length > 0
      ? context.organizationServices.join(', ')
      : 'No specific services defined';

  const isImage = mediaType === 'image';
  const mediaLabel = isImage ? 'photo' : 'video frames';
  const contentLabel = isImage ? 'image' : 'video';

  const resultDescription = isImage
    ? '"result" - Photo of a person showing a treatment outcome or transformation (face/body clearly visible, suitable for before/after showcase)'
    : '"result" - Before/after transformation content, person\'s face/body clearly visible (suitable for results showcase)';

  const supplementaryDescription = `"procedure" - Treatment/procedure being performed (hands at work, tools in use on a client)
   - "environment" - Business interior/exterior, equipment, products, ambiance (no procedure being performed)`;

  const imageClassificationHint = `\nIMPORTANT: NEVER use "b_roll" as a content type. Instead classify as:
- "procedure" if a treatment/service is being performed (hands working, tools on a client)
- "environment" if it shows the space, equipment, products, or ambiance without a procedure in progress
- "result" if a person's face or body is clearly the subject showing a treatment outcome\n`;

  return `You are analyzing ${mediaLabel} from a ${context.businessType} business.

Available services at this business:
${servicesList}

Analyze ${isImage ? 'this image' : 'these frames'} and provide a JSON response with:

1. "contentType": Classify the ${contentLabel} content as ONE of:
   - "talking_head" - Person speaking directly to camera (founder, practitioner, presenter)
   - ${supplementaryDescription}
   - "testimonial" - Customer speaking/reviewing, interview style
   - ${resultDescription}
   - "other" - Doesn't fit above categories
${imageClassificationHint}
2. "description": A specific description of what is VISIBLY happening. Name the
   instrument or product in use, the body area it is applied to, and what is
   being done — e.g. "a gloved practitioner injecting with a fine needle above
   the left eyebrow", not "a facial treatment". Report only what you can see.
   Do NOT name a service, and do NOT guess at intent. If a detail is not
   visible, leave it out rather than inferring it.

3. "observation": The same evidence, structured. Use null for anything not
   visible — null is a valid, expected answer.
   - "instrument": the specific tool/device/product in use, e.g. "syringe",
     "cannula", "laser handpiece", "IPL applicator", "microneedling pen",
     "RF applicator", "cryo applicator", "steamer", "cream or mask",
     "scissors", "colour brush", "tweezers", "nail tools", "hands only"
   - "bodyArea": e.g. "forehead", "brow", "eyes", "lips", "cheeks", "chin",
     "jaw", "full face", "neck", "scalp", "hair", "abdomen", "legs", "arms",
     "back", "hands", "feet", "teeth", "body-general"
   - "isRealFootage": false when this is an infographic, a poster, a screenshot,
     a text graphic, a logo, or any other designed/marketing asset rather than
     a photo or recording of a real person, place or procedure.

4. "serviceIdentification": Which service this ${contentLabel} DEPICTS.
   - "serviceName": the ONE service from the list above that is actually shown,
     or null if the visible evidence does not identify a specific service
   - "confidence": Number between 0 and 1
   - "alsoValidFor": Array of other service names from the list that are the
     SAME procedure as the one shown — e.g. tiers, durations, or treated-area
     variants of the same treatment. Empty array if none.

   RULES — read carefully, these matter more than any other field:
   - Identify what is DEPICTED, not what "relates to" the ${contentLabel}. A
     treatment room, a reception desk or a relaxed client does not depict every
     service the business offers.
   - Two services that differ only by duration, price, package tier or treated
     area are the SAME procedure. Put the one shown in "serviceName" and the
     rest in "alsoValidFor".
   - Two services performed with DIFFERENT instruments, or on different body
     areas, are NOT the same procedure and must never both appear.
   - If you cannot tell which specific service is shown, set "serviceName" to
     null. Returning null is CORRECT and is strongly preferred over guessing —
     a wrong identification causes us to publish the wrong footage for a
     treatment, which is far worse than no identification at all.

5. "suggestedTags": Array of 1-2 descriptive tags for the content shown.
   - Tag the specific procedure or service (e.g., "haircut", "facial", "massage", "body-contouring")
   - Optionally a second descriptive tag (e.g., "close-up", "consultation")
   - Do NOT repeat the content type as a tag — it is already captured in field 1.
   - NEVER suggest "before-after" or any tag asserting a client result: those
     tags drive published claims and must come from a person, not from vision.

6. "qualityScore": A number between 0 and 1 rating overall quality for marketing use:
   - 1.0 = Excellent (sharp, well-lit, stable, professional)
   - 0.7+ = Good (minor issues but usable)
   - 0.4-0.7 = Fair (noticeable issues)
   - Below 0.4 = Poor (significant issues, may not be usable)

7. "qualityFlags": Object with boolean flags for specific issues:
   - "isShaky": Camera is shaky/unstable
   - "isBlurry": Image is out of focus or motion-blurred
   - "isPoorLighting": Too dark, overexposed, or harsh shadows
   - "showsOnlyEquipment": Only shows tools/equipment without any procedure context
   - "isTooShort": Content appears to be a fragment (only relevant for video)
   Set each flag to true only if the issue is present.

Return ONLY valid JSON, no markdown or explanations.`;
}

/**
 * Turn the model's response into the `matchedServices` contract the rest of
 * the pipeline consumes.
 *
 * The prompt now asks what the asset DEPICTS (one service + same-procedure
 * variants) instead of what it "likely relates to" (unbounded, >= 0.5). That
 * older question is what produced 1,957 AI links in prod, 213 clips claiming
 * two or more treatments, and one claiming six unrelated modalities — a
 * treatment room genuinely "relates to" every service performed in it.
 *
 * Three rules:
 *   - Abstention (`serviceName: null`) yields an EMPTY list, so no link is
 *     written. That outcome was previously impossible.
 *   - A designed asset (`isRealFootage: false` — infographic, poster,
 *     screenshot) yields an empty list. Those were being cut into treatment
 *     videos as b-roll.
 *   - `alsoValidFor` inherits the primary's confidence: they are asserted to
 *     be the same procedure, so ranking them lower would be false precision.
 *
 * Falls back to the legacy `matchedServices` when the model doesn't supply the
 * new shape, so a non-compliant response degrades rather than losing tagging.
 */
export function deriveMatchedServices(
  parsed: VisionApiResponse
): VisionAnalysisResult['matchedServices'] {
  if (parsed.observation?.isRealFootage === false) return [];

  const ident = parsed.serviceIdentification;
  if (ident) {
    if (!ident.serviceName) return []; // explicit abstention
    const confidence = Math.min(1, Math.max(0, ident.confidence ?? 0));
    const primary = { serviceName: ident.serviceName, confidence };
    const family = (ident.alsoValidFor ?? [])
      .filter((name) => name && name !== ident.serviceName)
      .map((serviceName) => ({ serviceName, confidence }));
    return [primary, ...family];
  }

  return (parsed.matchedServices || [])
    .filter((s) => s.confidence >= 0.5)
    .map((s) => ({
      serviceName: s.serviceName,
      confidence: Math.min(1, Math.max(0, s.confidence)),
    }));
}

/** Normalise the structured observation, tolerating a partial response. */
function normalizeObservation(
  parsed: VisionApiResponse
): VisionAnalysisResult['observation'] {
  const o = parsed.observation;
  if (!o) return undefined;
  return {
    instrument: o.instrument ?? null,
    bodyArea: o.bodyArea ?? null,
    // Default TRUE: only an explicit false should exclude an asset, so a model
    // that omits the field doesn't silently strip real footage.
    isRealFootage: o.isRealFootage !== false,
  };
}

/**
 * Validate and normalize the content type from API response
 */
function normalizeContentType(rawType: string): AssetContentType {
  const validTypes: AssetContentType[] = [
    'talking_head',
    'procedure',
    'environment',
    'testimonial',
    'result',
    'other',
  ];

  const normalized = rawType.toLowerCase().replace(/[\s-]+/g, '_');

  // Map old/legacy enum values to current ones
  const migrationMap: Record<string, AssetContentType> = {
    before_after: 'result',
    portrait: 'result',
    founder_talking_head: 'talking_head',
    promo: 'procedure',
    b_roll: 'procedure',
  };

  const mapped = migrationMap[normalized] ?? normalized;
  return validTypes.includes(mapped as AssetContentType)
    ? (mapped as AssetContentType)
    : 'other';
}

/**
 * Analyze video frames or images using GPT-4 Vision
 *
 * @param framePaths - Paths to frame images (JPEG/PNG)
 * @param context - Business context for analysis
 * @param options - Optional config overrides
 * @param mediaType - Whether analysing video frames or a standalone image
 * @returns Analysis result with content type, matched services, and tags
 */
export async function analyzeFrames(
  framePaths: string[],
  context: VideoAnalysisContext,
  options?: Partial<VisionApiConfig>,
  mediaType: 'video' | 'image' = 'video'
): Promise<VisionAnalysisResult> {
  if (!client || !config) {
    throw new Error('Vision API not initialized. Call initVisionApi first.');
  }

  if (framePaths.length === 0) {
    throw new Error('No frames provided for analysis');
  }

  const effectiveConfig = { ...config, ...options };
  const model: VisionModel = effectiveConfig.model || 'gpt-4o';
  const maxTokens = effectiveConfig.maxTokens || 1000;

  if (effectiveConfig.verbose) {
    console.log(`[vision-api] Analyzing ${framePaths.length} frames`);
    console.log(`[vision-api] Model: ${model}`);
    console.log(
      `[vision-api] Services: ${context.organizationServices.join(', ')}`
    );
  }

  const startTime = Date.now();

  // Prepare images as base64, skipping missing files.
  // Encode inline so intermediate Buffers can be GC'd promptly.
  const imageContents: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

  for (const framePath of framePaths) {
    if (!fs.existsSync(framePath)) continue;

    const mimeType = framePath.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

    imageContents.push({
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${fs.readFileSync(framePath).toString('base64')}`,
        detail: 'low', // Use low detail to reduce tokens/cost
      },
    });
  }

  if (imageContents.length === 0) {
    throw new Error('No readable frame files found');
  }

  // Build the message content
  const messageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: buildAnalysisPrompt(context, mediaType),
    },
    ...imageContents,
  ];

  // Call GPT-4 Vision (with retry + backoff on empty/transient responses)
  const responseText = await createVisionCompletion(
    {
      model,
      max_tokens: maxTokens,
      messages: [
        {
          role: 'user',
          content: messageContent,
        },
      ],
      response_format: { type: 'json_object' },
    },
    effectiveConfig.verbose
  );

  const duration = Date.now() - startTime;

  if (effectiveConfig.verbose) {
    console.log(`[vision-api] Analysis completed in ${duration}ms`);
  }

  let parsed: VisionApiResponse;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Failed to parse Vision API response: ${responseText}`);
  }

  // Validate and normalize the response
  const result: VisionAnalysisResult = {
    description: parsed.description || 'No description available',
    contentType: normalizeContentType(parsed.contentType || 'other'),
    matchedServices: deriveMatchedServices(parsed),
    observation: normalizeObservation(parsed),
    serviceIdentification: parsed.serviceIdentification
      ? {
          serviceName: parsed.serviceIdentification.serviceName ?? null,
          confidence: Math.min(
            1,
            Math.max(0, parsed.serviceIdentification.confidence ?? 0)
          ),
          alsoValidFor: parsed.serviceIdentification.alsoValidFor ?? [],
        }
      : undefined,
    suggestedTags: (parsed.suggestedTags || [])
      .slice(0, 2)
      .map((tag) => tag.toLowerCase().replace(/\s+/g, '-')),
  };

  // Parse quality assessment
  if (typeof parsed.qualityScore === 'number') {
    result.qualityScore = Math.min(1, Math.max(0, parsed.qualityScore));
  }
  if (parsed.qualityFlags && typeof parsed.qualityFlags === 'object') {
    result.qualityFlags = {
      isShaky: !!parsed.qualityFlags.isShaky,
      isBlurry: !!parsed.qualityFlags.isBlurry,
      isPoorLighting: !!parsed.qualityFlags.isPoorLighting,
      showsOnlyEquipment: !!parsed.qualityFlags.showsOnlyEquipment,
      isTooShort: !!parsed.qualityFlags.isTooShort,
    };
  }

  if (effectiveConfig.verbose) {
    console.log(`[vision-api] Content type: ${result.contentType}`);
    console.log(
      `[vision-api] Matched services: ${result.matchedServices.length}`
    );
    console.log(`[vision-api] Tags: ${result.suggestedTags.join(', ')}`);
    console.log(`[vision-api] Quality score: ${result.qualityScore ?? 'N/A'}`);
  }

  return result;
}

/**
 * Quick content classification without full analysis
 * Uses fewer tokens for cost efficiency
 */
export async function classifyContent(
  framePaths: string[],
  options?: Partial<VisionApiConfig>
): Promise<AssetContentType> {
  if (!client || !config) {
    throw new Error('Vision API not initialized. Call initVisionApi first.');
  }

  if (framePaths.length === 0) {
    throw new Error('No frames provided for classification');
  }

  const effectiveConfig = { ...config, ...options };
  const model: VisionModel = effectiveConfig.model || 'gpt-4o-mini'; // Use cheaper model for simple classification

  // Use only the first frame for quick classification
  const framePath = framePaths[0];
  if (!fs.existsSync(framePath)) {
    throw new Error(`Frame file not found: ${framePath}`);
  }
  const imageBuffer = fs.readFileSync(framePath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = framePath.toLowerCase().endsWith('.png')
    ? 'image/png'
    : 'image/jpeg';

  // Best-effort classification: retry transient/empty responses, but never
  // throw — fall back to 'other' so a single bad frame can't break callers.
  let responseText = 'other';
  try {
    responseText = (
      await createVisionCompletion(
        {
          model,
          max_tokens: 50,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Classify this image from a beauty/wellness business. Reply with ONLY one word: talking_head, b_roll, procedure, environment, testimonial, result, or other',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`,
                    detail: 'low',
                  },
                },
              ],
            },
          ],
        },
        effectiveConfig.verbose
      )
    )
      .trim()
      .toLowerCase();
  } catch (error) {
    if (effectiveConfig.verbose) {
      console.log(
        `[vision-api] Classification failed, defaulting to 'other': ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return normalizeContentType(responseText);
}

/**
 * Build an analysis prompt that includes frame timestamps and asks for
 * action segment classification alongside the standard analysis fields.
 */
function buildSegmentAnalysisPrompt(
  context: VideoAnalysisContext,
  frameTimestamps: number[]
): string {
  const servicesList =
    context.organizationServices.length > 0
      ? context.organizationServices.join(', ')
      : 'No specific services defined';

  const frameLabels = frameTimestamps
    .map((t, i) => `  Frame ${i + 1}: ${t.toFixed(1)}s`)
    .join('\n');

  return `You are analyzing video frames from a ${context.businessType} business.

Available services at this business:
${servicesList}

The frames are extracted at these timestamps:
${frameLabels}

Analyze these frames and provide a JSON response with:

1. "contentType": Classify the video content as ONE of:
   - "talking_head" - Person speaking directly to camera (founder, practitioner, presenter)
   - "procedure" - Treatment/procedure being performed (hands at work, tools in use on a client)
   - "environment" - Business interior/exterior, equipment, products, ambiance (no procedure being performed)
   - "testimonial" - Customer speaking/reviewing, interview style
   - "result" - Before/after transformation content, person's face/body clearly visible (suitable for results showcase)
   - "other" - Doesn't fit above categories

IMPORTANT: NEVER use "b_roll" as a content type. Use "procedure" or "environment" instead.

2. "description": 3-5 sentences describing what is VISIBLY happening. Name the
   instrument or product in use, the body area it is applied to, what is being
   done, and the setting. Report only what you can see.
   - Do NOT name a service and do NOT guess at intent.
   - Do NOT hedge. Never write "possibly", "likely" or "appears to be" — if
     something is not visible, say that it is not visible.
   - State distinguishing ABSENCES, e.g. "no needle or syringe is visible",
     "the applicator head is flat and rectangular". What is absent is often
     what rules a treatment out.

3. "observation": The same evidence, structured. Use null for anything not
   visible — null is a valid, expected answer.
   - "instrument": the specific tool/device/product in use, e.g. "syringe",
     "cannula", "laser handpiece", "IPL applicator", "microneedling pen",
     "RF applicator", "cryo applicator", "steamer", "cream or mask",
     "scissors", "colour brush", "tweezers", "nail tools", "hands only"
   - "bodyArea": e.g. "forehead", "brow", "eyes", "lips", "cheeks", "chin",
     "jaw", "full face", "neck", "scalp", "hair", "abdomen", "legs", "arms",
     "back", "hands", "feet", "teeth", "body-general"
   - "isRealFootage": false when this is an infographic, a poster, a screenshot,
     a text graphic, a logo, or any other designed/marketing asset rather than
     a recording of a real person, place or procedure.

4. "serviceIdentification": Which service this video DEPICTS.
   - "serviceName": the ONE service from the list above that is actually shown,
     or null if the visible evidence does not identify a specific service
   - "confidence": Number between 0 and 1
   - "alsoValidFor": Array of other service names from the list that are the
     SAME procedure as the one shown — e.g. tiers, durations, or treated-area
     variants of the same treatment. Empty array if none.

   RULES — read carefully, these matter more than any other field:
   - Identify what is DEPICTED, not what "relates to" the video. A treatment
     room, a reception desk or a relaxed client does not depict every service
     the business offers.
   - Two services that differ only by duration, price, package tier or treated
     area are the SAME procedure. Put the one shown in "serviceName" and the
     rest in "alsoValidFor".
   - Two services performed with DIFFERENT instruments, or on different body
     areas, are NOT the same procedure and must never both appear.
   - If you cannot tell which specific service is shown, set "serviceName" to
     null. Returning null is CORRECT and is strongly preferred over guessing —
     a wrong identification causes us to publish the wrong footage for a
     treatment, which is far worse than no identification at all.

5. "suggestedTags": Array of 1-2 descriptive tags for the content shown.
   - Tag the specific procedure or service (e.g., "haircut", "facial", "massage", "body-contouring")
   - Optionally a second descriptive tag (e.g., "close-up", "consultation")
   - Do NOT repeat the content type as a tag — it is already captured in field 1.
   - NEVER suggest "before-after" or any tag asserting a client result: those
     tags drive published claims and must come from a person, not from vision.

6. "actionSegments": Array of contiguous time segments covering the full video duration.
   Each segment must have:
   - "startSec": Start time in seconds
   - "endSec": End time in seconds
   - "label": ONE of "action" (procedure/work being performed), "transition" (walking, entering, leaving, setup), or "idle" (static/waiting/no activity)
   - "description": Brief description of what's happening in this segment

   Segments should cover the video from start to end with no gaps.
   Use the frame timestamps above to estimate segment boundaries.

6. "qualityScore": A number between 0 and 1 rating overall quality for marketing use:
   - 1.0 = Excellent (sharp, well-lit, stable, professional)
   - 0.7+ = Good (minor issues but usable)
   - 0.4-0.7 = Fair (noticeable issues)
   - Below 0.4 = Poor (significant issues, may not be usable)

7. "qualityFlags": Object with boolean flags for specific issues:
   - "isShaky": Camera is shaky/unstable
   - "isBlurry": Image is out of focus or motion-blurred
   - "isPoorLighting": Too dark, overexposed, or harsh shadows
   - "showsOnlyEquipment": Only shows tools/equipment without any procedure context
   - "isTooShort": Content appears to be a fragment (only relevant for video)
   Set each flag to true only if the issue is present.

Return ONLY valid JSON, no markdown or explanations.`;
}

const VALID_SEGMENT_LABELS: ActionSegmentLabel[] = [
  'action',
  'transition',
  'idle',
];

/**
 * Validate, clamp, and sort raw action segments from the API response.
 * Returns undefined if the segments are empty or all invalid.
 */
function normalizeActionSegments(
  raw: VisionApiResponse['actionSegments'],
  videoDurationSec: number
): ActionSegment[] | undefined {
  if (!raw || raw.length === 0) return undefined;

  const normalized: ActionSegment[] = [];

  for (const seg of raw) {
    const label = seg.label?.toLowerCase() as ActionSegmentLabel;
    if (!VALID_SEGMENT_LABELS.includes(label)) continue;

    const startSec = Math.max(0, Math.min(seg.startSec, videoDurationSec));
    const endSec = Math.max(0, Math.min(seg.endSec, videoDurationSec));

    if (endSec <= startSec) continue;

    normalized.push({
      startSec,
      endSec,
      label,
      description: seg.description,
    });
  }

  if (normalized.length === 0) return undefined;

  normalized.sort((a, b) => a.startSec - b.startSec);
  return normalized;
}

/**
 * Analyze video frames with timestamps, producing both the standard
 * analysis result and action segment classifications.
 *
 * Falls back gracefully if segment parsing fails — returns the standard
 * result without segments rather than throwing.
 *
 * @param frames - Frames with their extraction timestamps
 * @param context - Business context for analysis
 * @param videoDurationSec - Total duration of the source video
 * @param options - Optional config overrides
 */
export async function analyzeFramesWithSegments(
  frames: FrameWithTimestamp[],
  context: VideoAnalysisContext,
  videoDurationSec: number,
  options?: Partial<VisionApiConfig>
): Promise<VisionAnalysisResult> {
  if (!client || !config) {
    throw new Error('Vision API not initialized. Call initVisionApi first.');
  }

  if (frames.length === 0) {
    throw new Error('No frames provided for analysis');
  }

  const effectiveConfig = { ...config, ...options };
  const model: VisionModel = effectiveConfig.model || 'gpt-4o';
  const maxTokens = effectiveConfig.maxTokens || 1500;

  if (effectiveConfig.verbose) {
    console.log(`[vision-api] Analyzing ${frames.length} frames with segments`);
    console.log(`[vision-api] Model: ${model}`);
    console.log(`[vision-api] Video duration: ${videoDurationSec.toFixed(1)}s`);
  }

  const startTime = Date.now();

  // Build message content: text prompt + labeled images
  const frameTimestamps = frames.map((f) => f.timestampSec);
  const messageContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    {
      type: 'text',
      text: buildSegmentAnalysisPrompt(context, frameTimestamps),
    },
  ];

  // Encode frames in batches to limit peak memory usage.
  // Each frame produces ~300-500KB of base64; loading all 10 at once
  // plus intermediate Buffers can exceed the per-job memory budget.
  const FRAME_BATCH_SIZE = 3;
  let readableFrameCount = 0;
  for (
    let batchStart = 0;
    batchStart < frames.length;
    batchStart += FRAME_BATCH_SIZE
  ) {
    const batch = frames.slice(batchStart, batchStart + FRAME_BATCH_SIZE);
    for (const frame of batch) {
      let rawBytes: Buffer;
      try {
        rawBytes = fs.readFileSync(frame.path);
      } catch {
        // Frame may have been cleaned up between extraction and read (race condition)
        continue;
      }

      const mimeType = frame.path.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';

      // Encode in one expression so the Buffer can be GC'd promptly
      const base64Url = `data:${mimeType};base64,${rawBytes.toString('base64')}`;

      // Label each image with its timestamp
      messageContent.push({
        type: 'text',
        text: `Frame ${readableFrameCount + 1} at ${frame.timestampSec.toFixed(1)}s:`,
      });
      messageContent.push({
        type: 'image_url',
        image_url: {
          url: base64Url,
          detail: 'low',
        },
      });
      readableFrameCount++;
    }
  }

  if (readableFrameCount === 0) {
    throw new Error('No readable frame files found');
  }

  // Call GPT-4 Vision (with retry + backoff on empty/transient responses)
  const responseText = await createVisionCompletion(
    {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: messageContent }],
      response_format: { type: 'json_object' },
    },
    effectiveConfig.verbose
  );

  const duration = Date.now() - startTime;

  if (effectiveConfig.verbose) {
    console.log(`[vision-api] Segment analysis completed in ${duration}ms`);
  }

  let parsed: VisionApiResponse;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error(`Failed to parse Vision API response: ${responseText}`);
  }

  // Normalize standard fields
  const result: VisionAnalysisResult = {
    description: parsed.description || 'No description available',
    contentType: normalizeContentType(parsed.contentType || 'other'),
    matchedServices: deriveMatchedServices(parsed),
    observation: normalizeObservation(parsed),
    serviceIdentification: parsed.serviceIdentification
      ? {
          serviceName: parsed.serviceIdentification.serviceName ?? null,
          confidence: Math.min(
            1,
            Math.max(0, parsed.serviceIdentification.confidence ?? 0)
          ),
          alsoValidFor: parsed.serviceIdentification.alsoValidFor ?? [],
        }
      : undefined,
    suggestedTags: (parsed.suggestedTags || [])
      .slice(0, 2)
      .map((tag) => tag.toLowerCase().replace(/\s+/g, '-')),
  };

  // Parse quality assessment
  if (typeof parsed.qualityScore === 'number') {
    result.qualityScore = Math.min(1, Math.max(0, parsed.qualityScore));
  }
  if (parsed.qualityFlags && typeof parsed.qualityFlags === 'object') {
    result.qualityFlags = {
      isShaky: !!parsed.qualityFlags.isShaky,
      isBlurry: !!parsed.qualityFlags.isBlurry,
      isPoorLighting: !!parsed.qualityFlags.isPoorLighting,
      showsOnlyEquipment: !!parsed.qualityFlags.showsOnlyEquipment,
      isTooShort: !!parsed.qualityFlags.isTooShort,
    };
  }

  // Normalize action segments (graceful fallback)
  try {
    result.actionSegments = normalizeActionSegments(
      parsed.actionSegments,
      videoDurationSec
    );
  } catch {
    if (effectiveConfig.verbose) {
      console.log('[vision-api] Failed to parse action segments, skipping');
    }
  }

  if (effectiveConfig.verbose) {
    console.log(`[vision-api] Content type: ${result.contentType}`);
    console.log(
      `[vision-api] Matched services: ${result.matchedServices.length}`
    );
    console.log(
      `[vision-api] Action segments: ${result.actionSegments?.length ?? 0}`
    );
  }

  return result;
}
