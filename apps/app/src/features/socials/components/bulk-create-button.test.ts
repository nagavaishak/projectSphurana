import { describe, expect, it } from 'vitest';
import { deriveBulkCreateState } from './bulk-create-button';

const readyGraphic = {
  reviewStatus: 'pending',
  kind: 'graphic',
  graphic: { status: 'ready' },
};
const renderingGraphic = {
  reviewStatus: 'pending',
  kind: 'graphic',
  graphic: { status: 'generating' },
};
const acceptedGraphic = {
  reviewStatus: 'accepted',
  kind: 'graphic',
  graphic: { status: 'ready' },
};

describe('deriveBulkCreateState', () => {
  it('offers a first batch when the org has none', () => {
    const s = deriveBulkCreateState(null, [], false);
    expect(s.disabled).toBe(false);
    expect(s.complete).toBe(false);
    expect(s.readyForReview).toBe(false);
  });

  it('re-arms the button once every item is reviewed', () => {
    // The bug this guards: a fully-reviewed batch used to park the button on a
    // disabled "Batch complete", and support was asked to reset it by hand.
    const s = deriveBulkCreateState(
      { status: 'generating' },
      [acceptedGraphic, acceptedGraphic],
      false
    );
    expect(s.complete).toBe(true);
    expect(s.disabled).toBe(false);
  });

  it('sends owners to review rather than a new batch while items wait', () => {
    // 'generating' is where a seeded batch STAYS — no writer moves it past.
    // Reading it as "still working" is what pinned the button on "Generating…"
    // with every asset long since rendered (ENG-788).
    const s = deriveBulkCreateState(
      { status: 'generating' },
      [readyGraphic, readyGraphic],
      false
    );
    expect(s.readyForReview).toBe(true);
    expect(s.complete).toBe(false);
    expect(s.disabled).toBe(false);
  });

  it('disables while assets are still rendering, counting the ready ones', () => {
    const s = deriveBulkCreateState(
      { status: 'generating' },
      [readyGraphic, renderingGraphic],
      false
    );
    expect(s.generating).toBe(true);
    expect(s.disabled).toBe(true);
    expect(s.createdCount).toBe(1);
    expect(s.total).toBe(2);
  });

  it('holds the seed window closed so a top-up cannot double-fire', () => {
    // 'planning' is the one status that precedes any item row — the server
    // returns a top-up to it too, so this covers the gap between the POST
    // landing and the new slots appearing.
    const s = deriveBulkCreateState({ status: 'planning' }, [], false);
    expect(s.disabled).toBe(true);
    expect(s.complete).toBe(false);
  });

  it('disables on the submitting click, before the batch changes status', () => {
    const s = deriveBulkCreateState({ status: 'generating' }, [], true);
    expect(s.disabled).toBe(true);
    expect(s.complete).toBe(false);
  });

  it('treats a failed asset as done rendering, not stuck', () => {
    const s = deriveBulkCreateState(
      { status: 'generating' },
      [{ reviewStatus: 'pending', kind: 'video', video: { status: 'failed' } }],
      false
    );
    expect(s.generating).toBe(false);
    expect(s.readyForReview).toBe(true);
  });

  it('offers a retry on a failed batch instead of a review', () => {
    const s = deriveBulkCreateState({ status: 'failed' }, [], false);
    expect(s.failed).toBe(true);
    expect(s.disabled).toBe(false);
    expect(s.complete).toBe(false);
    expect(s.readyForReview).toBe(false);
  });
});
