import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { generateAiImage } from './generate-ai-image.service.js';

describe('generateAiImage content-safety refusal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns a typed terminal model refusal when Gemini blocks an AI fill', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              promptFeedback: { blockReason: 'PROHIBITED_CONTENT' },
            }),
            { status: 200 }
          )
      )
    );

    const result = await generateAiImage({
      prompt: 'a treatment image',
      bbox: { w: 1080, h: 1350 },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.AI_MODEL_REFUSED);
      expect(result.error.details).toMatchObject({
        outcome: 'blocked',
        blockReason: 'PROHIBITED_CONTENT',
      });
    }
  });
});
