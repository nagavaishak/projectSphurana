import { describe, expect, it } from '@borradh-workspace/testing';
import {
  DECK_BRIEFS,
  RETIRED_SHAPES,
  SINGLE_BRIEFS,
  resolveDeckBrief,
  resolveSingleBrief,
} from './briefs.js';

/**
 * A brief's slug is persisted in `graphic.template_slug` and accepted from the
 * app and the assistant, so the properties worth pinning are the ones that make
 * a stored slug still mean something later.
 */
describe('briefs', () => {
  it('has unique slugs, and no slug collides with a replaced template', () => {
    for (const set of [DECK_BRIEFS, SINGLE_BRIEFS]) {
      const ids = set.flatMap((b) => [
        b.slug,
        ...(b.replaces ? [b.replaces] : []),
      ]);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('carries no appearance instruction — briefs are subject only', () => {
    // The audit that motivated briefs found every remaining defect class was
    // something a template ASKED for. These are the words that did it.
    const banned =
      /\b(layout|panel|uppercase|swipe|vote|button|colour|color|font|column|slide \d)\b/i;
    const offenders = [...DECK_BRIEFS, ...SINGLE_BRIEFS]
      .filter((b) => banned.test(b.brief))
      .map((b) => b.slug);
    expect(offenders).toEqual([]);
  });

  it('resolves an old composition-template slug to the brief that took it over', () => {
    expect(resolveDeckBrief('read-before-book', 'seed').slug).toBe(
      'before-and-after-the-visit'
    );
    expect(resolveSingleBrief('didyouknow-fact', 'seed').slug).toBe(
      'one-striking-fact'
    );
  });

  it('falls back to deterministic selection for a retired or unknown pin', () => {
    // Retired shapes must not resurrect the defect they were retired for, and a
    // stale pin must not fail a render.
    for (const retired of RETIRED_SHAPES) {
      expect(resolveSingleBrief(retired, 'seed').slug).toBe(
        resolveSingleBrief(undefined, 'seed').slug
      );
    }
    expect(resolveDeckBrief('no-such-thing', 'seed').slug).toBe(
      resolveDeckBrief(undefined, 'seed').slug
    );
  });

  it('is deterministic for a given seed', () => {
    expect(resolveDeckBrief(undefined, 'abc').slug).toBe(
      resolveDeckBrief(undefined, 'abc').slug
    );
  });
});
