import { describe, expect, it } from '@borradh-workspace/testing';
import type { OrgContext } from '../../../shared/org-context.js';
import { buildOrganicCopyPrompt } from './prompts.js';

const orgContext = {
  businessType: 'aesthetics_clinic',
  brandVoice: ['friendly', 'expert'],
  targetAudienceDescription: 'busy professionals',
  credibilityLine: '10 years experience',
  tagline: 'Look your best',
  services: ['Microneedling'],
  serviceDetails: [
    {
      name: 'Microneedling',
      painPoints: ['acne scars'],
      expectedResults: ['smoother skin'],
      processDescription: null,
      targetArea: 'face',
    },
  ],
} as unknown as OrgContext;

describe('buildOrganicCopyPrompt — refinement', () => {
  it('returns the base prompt unchanged when no instruction is given', () => {
    const base = buildOrganicCopyPrompt(orgContext, 'caption-tease-1');
    const withEmpty = buildOrganicCopyPrompt(orgContext, 'caption-tease-1', {});
    expect(withEmpty.userMessage).toBe(base.userMessage);
    expect(base.userMessage).not.toMatch(/User instruction/i);
  });

  it('appends an instruction-only block as upfront guidance', () => {
    const { userMessage } = buildOrganicCopyPrompt(
      orgContext,
      'caption-tease-1',
      { instruction: 'mention the £99 offer' }
    );
    expect(userMessage).toContain('mention the £99 offer');
    expect(userMessage).toMatch(/User instruction/i);
    expect(userMessage).not.toMatch(/PREVIOUS COPY/i);
  });

  it('feeds prior copy back when refining an existing draft', () => {
    const priorCopy = { headline: 'Old headline', caption: 'Read more' };
    const { userMessage } = buildOrganicCopyPrompt(
      orgContext,
      'caption-tease-1',
      { instruction: 'make the headline bolder', priorCopy }
    );
    expect(userMessage).toMatch(/PREVIOUS COPY/i);
    expect(userMessage).toContain('Old headline');
    expect(userMessage).toContain('make the headline bolder');
    // The same-shape instruction must be present so the model preserves keys.
    expect(userMessage).toMatch(/SAME JSON shape/i);
  });
});
