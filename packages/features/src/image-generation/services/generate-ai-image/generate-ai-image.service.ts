/**
 * `generateAiImage` — AI image generation via Google Gemini 2.5 Flash Image
 * (the model formerly known as "nano-banana").
 *
 * Used as the third tier of the slot-image resolver: when an org has no
 * service-linked video thumbnail or uploaded photo to back a dynamic
 * image slot, we generate a fresh image from the planner's prompt.
 *
 * Returns PNG bytes; the caller uploads to S3 + decides the cache key.
 * No caching layer here — the planner's prompts are slide+org-specific,
 * so the hit rate would be near zero.
 *
 * Provider: Google Gemini 2.5 Flash Image via the public REST endpoint:
 *   https://generativelanguage.googleapis.com/v1beta/models/
 *     gemini-2.5-flash-image:generateContent
 * Auth: query-string `?key=<GOOGLE_GENAI_API_KEY>`. The key is configured
 * in `packages/env/src/api.ts`.
 *
 * Aspect ratio is hinted via prompt-prefix (the model doesn't accept a
 * dedicated parameter — it uses the prompt for orientation cues).
 *
 * Cost: ~$0.04/image. Latency: ~3-8s p50.
 */

import { trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { callGeminiImage } from '../../gemini-image.js';

export interface GenerateAiImageInput {
  /** Natural-language image-generation prompt. */
  prompt: string;
  /**
   * Slot bounding box in canvas pixels. Mapped to an orientation hint
   * prepended to the prompt (the model uses prompt cues for aspect, not
   * a dedicated API parameter).
   */
  bbox: { w: number; h: number };
}

export interface GenerateAiImageOutput {
  /** Raw PNG bytes. Caller uploads + signs the URL. */
  png: Buffer;
  /** Orientation hint we sent the model. For audit / logs. */
  orientation: 'portrait' | 'landscape' | 'square';
}

const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

function pickOrientation(
  w: number,
  h: number
): 'portrait' | 'landscape' | 'square' {
  if (w <= 0 || h <= 0) return 'square';
  const r = w / h;
  if (r < 0.85) return 'portrait';
  if (r > 1.15) return 'landscape';
  return 'square';
}

async function generateAiImageImpl(
  input: GenerateAiImageInput
): Promise<Result<GenerateAiImageOutput>> {
  const promptText = input.prompt.trim();
  if (!promptText) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'generateAiImage requires a non-empty prompt.'
      )
    );
  }
  const orientation = pickOrientation(input.bbox.w, input.bbox.h);
  // Gemini's image model doesn't take an aspectRatio parameter; we cue it
  // via the prompt prefix. Underspecified orientations default to square.
  const orientationCue =
    orientation === 'portrait'
      ? 'Portrait orientation (taller than wide). '
      : orientation === 'landscape'
        ? 'Landscape orientation (wider than tall). '
        : 'Square orientation. ';
  const prompt = `${orientationCue}${promptText}`;
  // Keep the orientation cue used by this legacy slot-fill API, but route the
  // provider call through the canonical adapter. Maintaining a separate fetch
  // and response parser here caused Gemini safety blocks to be mislabeled as
  // internal errors after the shared adapter learned their typed semantics.
  const result = await callGeminiImage({
    model: GEMINI_IMAGE_MODEL,
    prompt,
  });
  if (!result.success) return err(result.error);

  return ok({
    png: result.data.png,
    orientation,
  });
}

export const generateAiImage = (input: GenerateAiImageInput) =>
  trackedResult(
    'imageGeneration.generateAiImage',
    () => generateAiImageImpl(input),
    {
      properties: {
        promptLength: input.prompt.length,
        bboxW: input.bbox.w,
        bboxH: input.bbox.h,
      },
    }
  );
