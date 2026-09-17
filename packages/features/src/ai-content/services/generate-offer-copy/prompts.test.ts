import { describe, expect, it } from '@borradh-workspace/testing';
import { buildOfferCopyUserPrompt } from './prompts.js';

const baseInput = {
  organizationName: 'Glow Clinic',
  businessType: 'aesthetics_clinic',
  offer: {
    name: 'Summer facial',
    discountType: 'percentage',
    discountPercent: 20,
    originalPriceCents: null,
    offerPriceCents: null,
    buyQuantity: null,
    getQuantity: null,
  },
  serviceNames: ['Facial'],
} as unknown as Parameters<typeof buildOfferCopyUserPrompt>[0];

describe('buildOfferCopyUserPrompt — refinement', () => {
  it('adds no change block when no instruction is given', () => {
    const prompt = buildOfferCopyUserPrompt(baseInput);
    expect(prompt).not.toMatch(/User instruction/i);
    expect(prompt).not.toMatch(/PREVIOUS COPY/i);
  });

  it('appends an instruction-only block as upfront guidance', () => {
    const prompt = buildOfferCopyUserPrompt({
      ...baseInput,
      refinementInstruction: 'warmer tone',
    });
    expect(prompt).toContain('warmer tone');
    expect(prompt).toMatch(/User instruction/i);
    expect(prompt).not.toMatch(/PREVIOUS COPY/i);
  });

  it('feeds prior copy back when refining', () => {
    const prompt = buildOfferCopyUserPrompt({
      ...baseInput,
      refinementInstruction: 'punchier headline',
      priorCopy: { headline: 'Old headline', ctaText: 'Book' },
    });
    expect(prompt).toMatch(/PREVIOUS COPY/i);
    expect(prompt).toContain('Old headline');
    expect(prompt).toContain('punchier headline');
    expect(prompt).toMatch(/SAME shape/i);
  });
});
