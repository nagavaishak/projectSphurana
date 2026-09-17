import { describe, expect, it } from '@borradh-workspace/testing';
import { buildRefinementBlock } from './generate-templated-single.service.js';

/**
 * Preserving the copy string alone was not enough. The model re-renders the
 * whole graphic every time, so a one-word change still shifted the imagery and
 * re-set the type — the copy was stable, the picture was not.
 *
 * The amendment path therefore does two things: hands the model the previous
 * version PLUS the exact target text, and withholds the competing references
 * (layout inspiration, brand example, subject photo) that otherwise give it
 * licence to re-compose.
 *
 * Claude still writes the target copy rather than letting the image model
 * rewrite text in-pixel: we would never learn what it actually rendered, so
 * `graphic.rendered_copy` would go stale and the NEXT edit would amend text
 * that is no longer on the graphic.
 */
describe('copy amendment', () => {
  it('hands over the previous copy verbatim so it can be preserved', () => {
    const prior = 'GLOW PEEL\nBrighter skin in one session\nBook now';
    const block = buildRefinementBlock(
      'Change the headline to RADIANCE',
      prior
    );

    expect(block).toContain(prior);
    expect(block).toContain('Change the headline to RADIANCE');
    expect(block).toContain('EDIT, NOT A REWRITE');
  });

  it('requires untouched lines to come back byte-for-byte', () => {
    const block = buildRefinementBlock('Change the CTA', 'A\nB\nC');
    expect(block).toMatch(/byte-for-byte identical/i);
    expect(block).toMatch(/do not reword/i);
  });

  it('degrades to a plain instruction for graphics with no stored copy', () => {
    // Graphics rendered before `rendered_copy` existed must still regenerate.
    const block = buildRefinementBlock('Change the CTA', null);
    expect(block).toContain('Change the CTA');
    expect(block).not.toContain('EDIT, NOT A REWRITE');
  });

  it('stays empty when nothing was asked for', () => {
    expect(buildRefinementBlock(undefined, 'Existing copy')).toBe('');
  });
});
