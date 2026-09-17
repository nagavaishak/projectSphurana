import { isGeminiBillingLimitError } from '../shared/index.js';

/**
 * Stable, user-reportable error codes for the asynchronous graphics pipeline.
 * Keep codes and user messages backwards compatible: they are persisted on
 * graphic rows and shown in Claire and the content library.
 */
export const GraphicGenerationErrorCodes = {
  MODEL_RATE_LIMITED: 'GFX-1001',
  MODEL_BILLING_EXHAUSTED: 'GFX-1002',
  MODEL_GENERATION_FAILED: 'GFX-1003',
  SOURCE_IMAGE_UNAVAILABLE: 'GFX-2001',
  INVALID_GENERATION_INPUT: 'GFX-2002',
  OUTPUT_UPLOAD_FAILED: 'GFX-3001',
  RESULT_SAVE_FAILED: 'GFX-3002',
  UNEXPECTED: 'GFX-9000',
} as const;

export type GraphicGenerationErrorCode =
  (typeof GraphicGenerationErrorCodes)[keyof typeof GraphicGenerationErrorCodes];

export const GraphicGenerationErrorMessages: Record<
  GraphicGenerationErrorCode,
  string
> = {
  [GraphicGenerationErrorCodes.MODEL_RATE_LIMITED]:
    'Image generation is temporarily busy. Please try again shortly.',
  [GraphicGenerationErrorCodes.MODEL_BILLING_EXHAUSTED]:
    'Image generation is temporarily unavailable. Please report this code to support.',
  [GraphicGenerationErrorCodes.MODEL_GENERATION_FAILED]:
    'The image service could not create this graphic. Try again or adjust the request.',
  [GraphicGenerationErrorCodes.SOURCE_IMAGE_UNAVAILABLE]:
    'One or more selected images could not be used. Choose different uploaded images and try again.',
  [GraphicGenerationErrorCodes.INVALID_GENERATION_INPUT]:
    'This graphic request is no longer valid. Review the service and images, then try again.',
  [GraphicGenerationErrorCodes.OUTPUT_UPLOAD_FAILED]:
    'The generated graphic could not be saved. Please try again.',
  [GraphicGenerationErrorCodes.RESULT_SAVE_FAILED]:
    'The generated graphic finished but its result could not be recorded. Please report this code to support.',
  [GraphicGenerationErrorCodes.UNEXPECTED]:
    'An unexpected graphics error occurred. Please report this code to support.',
};

export interface GraphicGenerationFailureDetails {
  code: GraphicGenerationErrorCode;
  userMessage: string;
  providerCode?: string;
  retryable: boolean;
}

export interface ClassifyGraphicGenerationFailureInput {
  message: string;
  providerCode?: string;
  publicCode?: GraphicGenerationErrorCode;
}

const failure = (
  code: GraphicGenerationErrorCode,
  providerCode?: string,
  retryable = false
): GraphicGenerationFailureDetails => ({
  code,
  userMessage: GraphicGenerationErrorMessages[code],
  providerCode,
  retryable,
});

/** Map internal/provider failures to the stable code exposed to users. */
export function classifyGraphicGenerationFailure({
  message,
  providerCode,
  publicCode,
}: ClassifyGraphicGenerationFailureInput): GraphicGenerationFailureDetails {
  if (publicCode) {
    return failure(publicCode, providerCode, true);
  }

  if (isGeminiBillingLimitError(message)) {
    return failure(
      GraphicGenerationErrorCodes.MODEL_BILLING_EXHAUSTED,
      providerCode
    );
  }
  if (providerCode === 'RATE_LIMITED') {
    return failure(
      GraphicGenerationErrorCodes.MODEL_RATE_LIMITED,
      providerCode,
      true
    );
  }
  if (providerCode === 'VALIDATION_ERROR' || providerCode === 'INVALID_INPUT') {
    return failure(
      GraphicGenerationErrorCodes.INVALID_GENERATION_INPUT,
      providerCode
    );
  }
  if (providerCode === 'NOT_FOUND') {
    return failure(
      /asset|image|media|source/i.test(message)
        ? GraphicGenerationErrorCodes.SOURCE_IMAGE_UNAVAILABLE
        : GraphicGenerationErrorCodes.INVALID_GENERATION_INPUT,
      providerCode
    );
  }
  if (providerCode) {
    return failure(
      GraphicGenerationErrorCodes.MODEL_GENERATION_FAILED,
      providerCode,
      providerCode === 'TIMEOUT' || providerCode === 'EXTERNAL_SERVICE_ERROR'
    );
  }
  if (/no prior slide/i.test(message)) {
    return failure(GraphicGenerationErrorCodes.INVALID_GENERATION_INPUT);
  }
  return failure(GraphicGenerationErrorCodes.UNEXPECTED, undefined, true);
}
