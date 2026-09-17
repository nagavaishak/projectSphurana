import { describe, expect, it } from 'vitest';
import { estimateGeminiImageCost } from './gemini-image-pricing.js';

describe('estimateGeminiImageCost', () => {
  it('prices a Nano Banana Pro generation with no input images', () => {
    const cost = estimateGeminiImageCost('gemini-3-pro-image', 0);
    expect(cost.inputCostUsd).toBe(0);
    expect(cost.outputCostUsd).toBe(0.134);
    expect(cost.totalCostUsd).toBe(0.134);
  });

  it('adds per-input-image cost for reference/subject images', () => {
    const cost = estimateGeminiImageCost('gemini-3-pro-image', 3);
    expect(cost.inputCostUsd).toBeCloseTo(0.0033, 6);
    expect(cost.totalCostUsd).toBeCloseTo(0.1373, 6);
  });

  it('prices the flash variants at their lower output rate', () => {
    expect(
      estimateGeminiImageCost('gemini-3.1-flash-image', 0).outputCostUsd
    ).toBe(0.067);
    expect(
      estimateGeminiImageCost('gemini-2.5-flash-image', 0).outputCostUsd
    ).toBe(0.039);
  });

  it('falls back to the pro price for an unknown model id (never $0)', () => {
    const cost = estimateGeminiImageCost('gemini-99-future-image', 0);
    expect(cost.outputCostUsd).toBe(0.134);
  });

  it('clamps negative input-image counts to zero', () => {
    expect(estimateGeminiImageCost('gemini-3-pro-image', -5).inputCostUsd).toBe(
      0
    );
  });
});
