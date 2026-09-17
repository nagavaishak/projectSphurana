import { describe, expect, it } from '@borradh-workspace/testing';
import { buildRefinementBlock } from './generate-templated-single.service.js';

/**
 * Copy is written fresh by Claude on every render, and Gemini transcribes
 * whatever string it is handed ("Render EXACTLY this copy"). So when a
 * regenerate had no previous text to work from, asking to change the headline
 * produced a brand-new headline AND a brand-new body and CTA — the model was
 * writing a new deck, and Gemini faithfully rendered it.
 *
 * Observed live: a single graphic regenerated immediately after creation (so
 * the prior IMAGE was passed successfully) still came back with every line of
 * text changed. That isolates the cause to the copy path.
 */
describe('buildRefinementBlock', () => {
  it('is empty without an instruction — a plain render is untouched', () => {
    expect(buildRefinementBlock(undefined, 'Existing copy')).toBe('');
    expect(buildRefinementBlock('   ', 'Existing copy')).toBe('');
  });

  it('demands a surgical edit when the prior copy is known', () => {
    const block = buildRefinementBlock(
      'Change the headline',
      'HEAD\nBODY\nCTA'
    );

    expect(block).toContain('EDIT, NOT A REWRITE');
    expect(block).toContain('Change the headline');
    // The previous text must be present verbatim for the model to preserve it.
    expect(block).toContain('HEAD\nBODY\nCTA');
    expect(block).toMatch(/byte-for-byte identical/i);
  });

  it('falls back to the old behaviour when no prior copy exists', () => {
    // Graphics rendered before this column existed have no stored copy. They
    // must still regenerate rather than fail — just without the guarantee.
    const block = buildRefinementBlock('Change the headline', null);

    expect(block).toContain('Change the headline');
    expect(block).not.toContain('EDIT, NOT A REWRITE');
  });

  it('treats blank prior copy as absent', () => {
    const block = buildRefinementBlock('Change the headline', '   ');
    expect(block).not.toContain('EDIT, NOT A REWRITE');
  });
});
