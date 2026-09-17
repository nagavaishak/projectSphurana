import { describe, expect, it } from '@borradh-workspace/testing';
import { rankByDescription } from './rank-by-description.js';

const clip = (id: string, description: string | null) => ({ id, description });

describe('rankByDescription', () => {
  // The behaviour this replaces: `candidates.shift()`, so "swap clip 2 for
  // something with the treatment room" returned whatever was at the front.
  it('puts the clip the owner described first', () => {
    const ranked = rankByDescription(
      [
        clip('a', 'Dentist smiling at a patient'),
        clip('b', 'Wide pan of the treatment room'),
        clip('c', 'Close-up of a syringe tray'),
      ],
      'something with the treatment room in it'
    );

    expect(ranked[0].id).toBe('b');
  });

  // A swap the owner asked for has to happen. Returning nothing leaves them
  // looking at the clip they just said was wrong.
  it('keeps clips that match nothing rather than dropping them', () => {
    const ranked = rankByDescription(
      [clip('a', 'Reception desk'), clip('b', 'Hands applying cream')],
      'underwater volcano'
    );

    expect(ranked.map((c) => c.id)).toEqual(['a', 'b']);
  });

  // The bank's own order is service-matched first, generic after. With nothing
  // to rank by, that order is the best signal available.
  it('leaves the order alone when nothing was described', () => {
    const clips = [clip('a', 'One'), clip('b', 'Two'), clip('c', 'Three')];

    expect(rankByDescription(clips, undefined).map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(rankByDescription(clips, '   ').map((c) => c.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  // "change the second clip" carries no criteria — every token is a stopword,
  // so there is nothing to rank by and the pool order stands.
  it('ignores a query made only of filler', () => {
    const clips = [clip('a', 'Reception desk'), clip('b', 'Treatment room')];

    expect(
      rankByDescription(clips, 'change it for something different').map(
        (c) => c.id
      )
    ).toEqual(['a', 'b']);
  });

  it('ranks a clip with more matching words above one with fewer', () => {
    const ranked = rankByDescription(
      [
        clip('a', 'A room in a clinic'),
        clip('b', 'Treatment room with a laser machine'),
      ],
      'treatment room with the laser'
    );

    expect(ranked[0].id).toBe('b');
  });

  it('survives a clip with no description at all', () => {
    const ranked = rankByDescription(
      [clip('a', null), clip('b', 'Treatment room')],
      'treatment room'
    );

    expect(ranked[0].id).toBe('b');
  });

  // Ties keep their original order, so ranking never reshuffles equals.
  it('is stable across equal scores', () => {
    const ranked = rankByDescription(
      [
        clip('a', 'Treatment room one'),
        clip('b', 'Treatment room two'),
        clip('c', 'Treatment room three'),
      ],
      'treatment room'
    );

    expect(ranked.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });
});
