import { describe, expect, it } from 'vitest';
import {
  type BuildBorradhPromptParams,
  buildBorradhSystemPrompt,
} from './borradh-prompt-builder.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeParams = (
  overrides: Partial<BuildBorradhPromptParams> = {}
): BuildBorradhPromptParams => ({
  organizationName: 'Chase Health Solutions',
  chatbotSettings: null,
  services: [],
  defaultBookingLink: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Custom directive
// ---------------------------------------------------------------------------

describe('buildBorradhSystemPrompt — custom directive', () => {
  it('omits the directive block when the org has no custom prompt', () => {
    const prompt = buildBorradhSystemPrompt(makeParams());
    expect(prompt).not.toContain('=== CUSTOM DIRECTIVE');
  });

  it('places the directive at the very top of the prompt', () => {
    const prompt = buildBorradhSystemPrompt(
      makeParams({ customSystemPrompt: 'the £75 special is for Mondays only' })
    );
    expect(prompt.startsWith('=== CUSTOM DIRECTIVE')).toBe(true);
    expect(prompt).toContain('the £75 special is for Mondays only');
    expect(prompt).toContain('=== END CUSTOM DIRECTIVE ===');
  });

  // ENG-731: Chase Health's directive said the £75 price was Mondays only.
  // The bot repeated the number and dropped the condition, telling customers
  // the price was "reduced from £160 to £75". The directive wrapper has to
  // say that a qualifier travels with the fact it qualifies.
  it('tells the model to carry conditions along with directive facts', () => {
    const prompt = buildBorradhSystemPrompt(
      makeParams({ customSystemPrompt: 'the £75 special is for Mondays only' })
    );

    const directiveBlock = prompt.slice(
      0,
      prompt.indexOf('=== END CUSTOM DIRECTIVE ===')
    );

    expect(directiveBlock).toContain(
      'When you repeat a fact from this directive, repeat its conditions with it.'
    );
    expect(directiveBlock).toMatch(/part of that fact, not an optional detail/);
  });
});

// ---------------------------------------------------------------------------
// Conditional / promotional pricing
// ---------------------------------------------------------------------------

describe('buildBorradhSystemPrompt — conditional pricing rules', () => {
  it('ships the conditional pricing rule in every prompt', () => {
    const prompt = buildBorradhSystemPrompt(makeParams());
    expect(prompt).toContain(
      '=== CONDITIONAL AND PROMOTIONAL PRICING (HARD RULE) ==='
    );
  });

  it('bans quoting an offer price as the standard price', () => {
    const prompt = buildBorradhSystemPrompt(makeParams());
    expect(prompt).toContain('NEVER present an offer price as the price.');
    expect(prompt).toContain(
      'the condition MUST be in the SAME sentence, and the standard price must be there too'
    );
  });

  it('bans "down from" framing for a conditional offer', () => {
    const prompt = buildBorradhSystemPrompt(makeParams());
    expect(prompt).toMatch(
      /Never use "down from", "reduced from", "was X now Y"/
    );
  });

  it('points the standard pricing rules at the conditional pricing section', () => {
    const prompt = buildBorradhSystemPrompt(makeParams());
    const pricingRules = prompt.slice(prompt.indexOf('=== PRICING RULES ==='));
    expect(pricingRules).toContain(
      'See CONDITIONAL AND PROMOTIONAL PRICING below before quoting any other number.'
    );
  });

  it('requires the offer condition in the dead-conversation follow-ups', () => {
    const prompt = buildBorradhSystemPrompt(makeParams());
    const followUps = prompt.slice(
      prompt.indexOf('=== FOLLOW-UP MESSAGES ===')
    );
    // Both follow-up templates carry an [offer condition] placeholder so the
    // model cannot re-send a bare offer price after the conversation dies.
    expect(followUps.match(/\[offer condition/g)?.length).toBe(2);
  });
});
