import { describe, expect, it } from 'vitest';

import { describeDiff, isEmptyDiff } from './describe-diff';

/**
 * The diff card's line is the only place a user is told what a turn did, and it
 * is built from the server's `diff` alone. These pin the wording, including the
 * cases the contract's example does not show (removals, singulars, a no-op).
 */
describe('describeDiff', () => {
  it('renders the shape from the contract example', () => {
    expect(
      describeDiff({ added: 2, edited: 1, removed: 0, themeChanged: false })
    ).toBe('+2 blocks, ~1 edited, theme unchanged');
  });

  it('uses the singular for one block', () => {
    expect(
      describeDiff({ added: 1, edited: 0, removed: 0, themeChanged: false })
    ).toBe('+1 block, theme unchanged');
  });

  it('reports removals and a theme change', () => {
    expect(
      describeDiff({ added: 0, edited: 0, removed: 3, themeChanged: true })
    ).toBe('-3 removed, theme changed');
  });

  it('says so when only the theme moved', () => {
    expect(
      describeDiff({ added: 0, edited: 0, removed: 0, themeChanged: true })
    ).toBe('No block changes, theme changed');
  });

  it('never claims a change that the diff does not report', () => {
    expect(
      describeDiff({ added: 0, edited: 0, removed: 0, themeChanged: false })
    ).toBe('No block changes, theme unchanged');
  });
});

describe('isEmptyDiff', () => {
  it('is true only when nothing at all changed', () => {
    expect(
      isEmptyDiff({ added: 0, edited: 0, removed: 0, themeChanged: false })
    ).toBe(true);
    expect(
      isEmptyDiff({ added: 0, edited: 0, removed: 0, themeChanged: true })
    ).toBe(false);
    expect(
      isEmptyDiff({ added: 0, edited: 1, removed: 0, themeChanged: false })
    ).toBe(false);
  });
});
