import { describe, expect, it } from '@borradh-workspace/testing';
import type { OrgContext } from '../../../shared/org-context.js';
import type { TemplateVariation } from '../../templates/index.js';
import { buildVideoScriptPrompt } from './prompts.js';

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

const variation = {
  id: 'var_1',
  variationName: 'Owner intro',
  description: 'Owner introduces the service',
  scriptTemplate: 'Hi, I offer [SERVICE NAME].',
  narrationMode: 'recorded',
  recommendedClipCount: 3,
} as unknown as TemplateVariation;

describe('buildVideoScriptPrompt — refinement', () => {
  it('omits any refinement block when no instruction is given', () => {
    const { userMessage } = buildVideoScriptPrompt(orgContext, variation);
    expect(userMessage).not.toMatch(/User instruction/i);
    expect(userMessage).not.toMatch(/previous script/i);
  });

  it('appends an instruction-only block as upfront guidance', () => {
    const { userMessage } = buildVideoScriptPrompt(
      orgContext,
      variation,
      undefined,
      { instruction: 'make it punchier' }
    );
    expect(userMessage).toContain('make it punchier');
    expect(userMessage).toMatch(/User instruction/i);
    // Without prior script text there is no "previous script" framing.
    expect(userMessage).not.toMatch(/previous script/i);
  });

  it('anchors the change to the prior script when one is provided', () => {
    const { userMessage } = buildVideoScriptPrompt(
      orgContext,
      variation,
      undefined,
      { instruction: 'shorten it', priorScriptText: 'A long previous script.' }
    );
    expect(userMessage).toContain('A long previous script.');
    expect(userMessage).toContain('shorten it');
    expect(userMessage).toMatch(/previous script/i);
  });
});
