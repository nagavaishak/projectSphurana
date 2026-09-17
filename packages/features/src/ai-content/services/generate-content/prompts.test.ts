import { describe, expect, it } from 'vitest';
import type { OrgContext } from '../../../shared/org-context.js';
import { buildAdPrompt } from './prompts.js';

const orgContext: OrgContext = {
  businessType: 'beauty_salon',
  brandVoice: ['warm', 'professional'],
  targetAudienceDescription: 'Women 30-55 in Dublin',
  credibilityLine: '10 years in practice',
  tagline: 'Glow naturally',
  services: ['Microdermabrasion'],
  serviceDetails: [],
};

describe('buildAdPrompt — §8 locked ad-text structure', () => {
  it('enforces the fixed "Message us to book" CTA', () => {
    const { systemMessage, userMessage } = buildAdPrompt(
      orgContext,
      'A facial treatment demo video',
      undefined,
      undefined,
      true
    );

    expect(systemMessage).toContain('Message us to book');
    // The CTA wording is described as fixed, not a free choice.
    expect(systemMessage).toMatch(/FIXED|exactly "Message us to book"/);
    // The instruction-format JSON also nails the CTA into primaryText.
    expect(userMessage).toContain('Message us to book');
  });

  it('locks the four-part structure (one pain point → one service → one offer → CTA)', () => {
    const { systemMessage } = buildAdPrompt(
      orgContext,
      'A facial treatment demo video',
      undefined,
      undefined,
      true
    );

    expect(systemMessage).toMatch(/ONE pain point/i);
    expect(systemMessage).toMatch(/ONE service/i);
    expect(systemMessage).toMatch(/ONE offer/i);
    // Named by what it does/solves, not the clinical name.
    expect(systemMessage).toMatch(
      /named by what it (does|solves|DOES|SOLVES)/i
    );
    // No stacking of multiple pain points / services.
    expect(systemMessage).toMatch(/no stacking|do NOT stack|Do NOT stack/i);
  });

  it('bans percentage discounts and only allows €-amount phrasing', () => {
    const { systemMessage } = buildAdPrompt(
      orgContext,
      'A facial treatment demo video',
      undefined,
      undefined,
      true
    );

    expect(systemMessage).toMatch(/NEVER use a percentage discount/i);
    expect(systemMessage).toContain('Just €X');
    expect(systemMessage).toContain('Was €X → now €X');
  });

  it('instructs the copy to fit one screen (short)', () => {
    const { systemMessage } = buildAdPrompt(
      orgContext,
      'A facial treatment demo video',
      undefined,
      undefined,
      true
    );

    expect(systemMessage).toMatch(/one phone screen|one screen|SHORT/i);
  });

  it('defaults to value-led copy and only enables an intro offer explicitly', () => {
    const { systemMessage, userMessage } = buildAdPrompt(
      orgContext,
      'A facial treatment demo video'
    );

    expect(systemMessage).toContain('VALUE ANGLE (the default)');
    expect(systemMessage).toContain('Do not invent a price');
    expect(userMessage).not.toContain('one offer → "Message us to book"');
  });
});
