import { describe, expect, it } from 'vitest';
import {
  GraphicGenerationErrorCodes,
  GraphicGenerationErrorMessages,
  classifyGraphicGenerationFailure,
} from './graphic-generation-errors.js';

describe('graphic generation error codes', () => {
  it('keeps every public code unique and paired with a safe message', () => {
    const codes = Object.values(GraphicGenerationErrorCodes);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) {
      expect(code).toMatch(/^GFX-\d{4}$/);
      expect(GraphicGenerationErrorMessages[code]).toBeTruthy();
    }
  });

  it('classifies billing exhaustion separately from transient rate limits', () => {
    expect(
      classifyGraphicGenerationFailure({
        providerCode: 'RATE_LIMITED',
        message: 'Your prepayment credits are depleted.',
      })
    ).toMatchObject({ code: 'GFX-1002', retryable: false });
    expect(
      classifyGraphicGenerationFailure({
        providerCode: 'RATE_LIMITED',
        message: 'Too many requests',
      })
    ).toMatchObject({ code: 'GFX-1001', retryable: true });
  });

  it('classifies the Google AI Studio monthly spending cap as non-retryable', () => {
    expect(
      classifyGraphicGenerationFailure({
        providerCode: 'RATE_LIMITED',
        message:
          'Gemini returned 429: Your billing account has exceeded its monthly spending cap. Please go to AI Studio at https://ai.studio/billing to manage your billing. Learn more at https://ai.google.dev/gemini-api/docs/billing#tier-spend-caps.',
      })
    ).toMatchObject({ code: 'GFX-1002', retryable: false });
  });

  it('distinguishes selected-image failures from invalid requests', () => {
    expect(
      classifyGraphicGenerationFailure({
        providerCode: 'NOT_FOUND',
        message: 'Selected source asset not found',
      }).code
    ).toBe('GFX-2001');
    expect(
      classifyGraphicGenerationFailure({
        providerCode: 'VALIDATION_ERROR',
        message: 'Invalid slide index',
      }).code
    ).toBe('GFX-2002');
  });

  it('preserves explicit storage/database codes', () => {
    expect(
      classifyGraphicGenerationFailure({
        publicCode: GraphicGenerationErrorCodes.OUTPUT_UPLOAD_FAILED,
        message: 'upload failed',
      })
    ).toMatchObject({ code: 'GFX-3001', retryable: true });
  });
});
