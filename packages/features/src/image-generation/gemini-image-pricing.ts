/**
 * Per-image cost estimates for Gemini image-generation models ("nano banana").
 *
 * PostHog's LLM analytics auto-calculates cost from token counts, but Gemini's
 * image REST endpoint reports NO token usage, and these image models aren't in
 * PostHog's token price catalog — so `$ai_generation` cost resolves to $0 for
 * every image call. We compute an explicit cost here and pass it to
 * `captureAiGeneration` so image spend shows up alongside the text models.
 *
 * Prices are Google's published Standard (paid) tier, USD, as of 2026-06:
 * https://ai.google.dev/gemini-api/docs/pricing
 *
 * RESOLUTION ASSUMPTION: `callGeminiImage` does not request a specific output
 * resolution, so the models return at their default (≤2K). We therefore price
 * at the 1K/2K tier. If we ever request 4K, these numbers undercount and the
 * map should grow a per-resolution dimension.
 *
 *   Model                     Output (1K/2K)   Input image (each)
 *   gemini-3-pro-image        $0.134/image     $0.0011   (Nano Banana Pro)
 *   gemini-3.1-flash-image    $0.067/image     ~$0.0006  (1K default)
 *   gemini-2.5-flash-image    $0.039/image     ~$0.0004  (legacy)
 *
 * Input-image cost is the reference/subject images we send as `inlineData`
 * (style refs + composited subject photos), priced per the model's input
 * image-token rate. It's a small fraction of the output cost; the pro figure
 * is Google's published "$0.0011 per image", the flash figures are derived
 * from the per-1M input-token rate at ~1100 image tokens and rounded.
 */

export interface GeminiImagePrice {
  /** Cost of one generated output image, USD (≤2K resolution). */
  outputPerImageUsd: number;
  /** Cost of one input reference/subject image, USD. */
  inputPerImageUsd: number;
}

const GEMINI_IMAGE_PRICES: Record<string, GeminiImagePrice> = {
  'gemini-3-pro-image': { outputPerImageUsd: 0.134, inputPerImageUsd: 0.0011 },
  'gemini-3.1-flash-image': {
    outputPerImageUsd: 0.067,
    inputPerImageUsd: 0.0006,
  },
  'gemini-2.5-flash-image': {
    outputPerImageUsd: 0.039,
    inputPerImageUsd: 0.0004,
  },
};

/** Fallback for an unknown image model id — price as Nano Banana Pro so spend
 * is never silently undercounted to $0. */
const FALLBACK_PRICE: GeminiImagePrice =
  GEMINI_IMAGE_PRICES['gemini-3-pro-image'];

/**
 * Estimate the USD cost of one Gemini image generation: one output image plus
 * `inputImageCount` reference/subject images. Returns `{ totalUsd }` (and the
 * input/output split) suitable for passing straight to `captureAiGeneration`.
 */
export const estimateGeminiImageCost = (
  model: string,
  inputImageCount: number
): { inputCostUsd: number; outputCostUsd: number; totalCostUsd: number } => {
  const price = GEMINI_IMAGE_PRICES[model] ?? FALLBACK_PRICE;
  const inputCostUsd = Math.max(0, inputImageCount) * price.inputPerImageUsd;
  const outputCostUsd = price.outputPerImageUsd;
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd: inputCostUsd + outputCostUsd,
  };
};
