import { describe, expect, it } from '@borradh-workspace/testing';
import { postCaptionOutputSchema } from './generate-post-caption.schema.js';

/**
 * The observed failures, verbatim lengths. Every one overshot; not one was
 * short. A caption that runs long used to drop the whole planned video,
 * because `dispatchMonthlyPlan` treats a caption error as fatal to the item —
 * one org lost all three of its videos for the month this way.
 */
const OBSERVED_FAILURE_LENGTHS = [540, 567, 678, 680, 702, 719, 758];

const caption = (n: number) => 'a'.repeat(n);

describe('postCaptionOutputSchema', () => {
  it('accepts every length that used to cost a video', () => {
    for (const len of OBSERVED_FAILURE_LENGTHS) {
      expect(
        postCaptionOutputSchema.safeParse({ caption: caption(len) }).success
      ).toBe(true);
    }
  });

  it('still rejects a one-line caption', () => {
    // The floor has never been hit in practice; a 40-character caption is a
    // defect rather than a style choice, so it stays.
    expect(
      postCaptionOutputSchema.safeParse({ caption: caption(40) }).success
    ).toBe(false);
  });

  it('still rejects an essay', () => {
    expect(
      postCaptionOutputSchema.safeParse({ caption: caption(1500) }).success
    ).toBe(false);
  });

  it('allows the longest caption the model actually produced, with headroom', () => {
    const worst = Math.max(...OBSERVED_FAILURE_LENGTHS);
    expect(
      postCaptionOutputSchema.safeParse({ caption: caption(worst + 200) })
        .success
    ).toBe(true);
  });
});
