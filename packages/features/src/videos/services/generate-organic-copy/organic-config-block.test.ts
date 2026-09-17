import { describe, expect, it } from '@borradh-workspace/testing';
import type { GeneratedOrganicCopy } from './generate-organic-copy.schema.js';
import { organicCopyToConfigBlock } from './organic-config-block.js';

describe('organicCopyToConfigBlock', () => {
  it('maps caption-tease copy into the captionTease block', () => {
    const copy: GeneratedOrganicCopy = {
      kind: 'caption-tease',
      config: {
        headline: 'Tighter skin in 20 minutes',
        emphasis: '20 minutes',
        emoji: '✨',
        caption: 'No downtime',
      },
    };

    const block = organicCopyToConfigBlock(copy);

    expect(block).toEqual({
      captionTease: {
        headline: 'Tighter skin in 20 minutes',
        caption: 'No downtime',
        emphasis: '20 minutes',
        emoji: '✨',
      },
    });
    // Exactly one organic key is populated.
    expect(Object.keys(block)).toEqual(['captionTease']);
  });

  it('coerces caption-tease null optionals to undefined (model emits null)', () => {
    const copy: GeneratedOrganicCopy = {
      kind: 'caption-tease',
      config: {
        headline: 'Glow up',
        emphasis: null,
        emoji: null,
        caption: 'Book today',
      },
    };

    const block = organicCopyToConfigBlock(copy);

    expect(block.captionTease).toEqual({
      headline: 'Glow up',
      caption: 'Book today',
      emphasis: undefined,
      emoji: undefined,
    });
    // null must never leak through — the renderer only accepts string | undefined.
    expect(block.captionTease?.emphasis).toBeUndefined();
    expect(block.captionTease?.emoji).toBeUndefined();
  });

  it('maps ins-outs copy and coerces null labels to undefined', () => {
    const copy: GeneratedOrganicCopy = {
      kind: 'ins-outs',
      config: {
        title: '2026 skincare',
        insLabel: null,
        insItems: ['SPF daily', 'Retinol', 'Hydration'],
        outsLabel: null,
        outsItems: ['Tanning beds', 'Harsh scrubs', 'Skipping SPF'],
      },
    };

    const block = organicCopyToConfigBlock(copy);

    expect(block).toEqual({
      insOuts: {
        title: '2026 skincare',
        insItems: ['SPF daily', 'Retinol', 'Hydration'],
        outsItems: ['Tanning beds', 'Harsh scrubs', 'Skipping SPF'],
        insLabel: undefined,
        outsLabel: undefined,
      },
    });
    expect(Object.keys(block)).toEqual(['insOuts']);
  });

  it('passes ins-outs labels through when present', () => {
    const copy: GeneratedOrganicCopy = {
      kind: 'ins-outs',
      config: {
        title: 'Trends',
        insLabel: 'IN',
        insItems: ['a', 'b', 'c'],
        outsLabel: 'OUT',
        outsItems: ['x', 'y', 'z'],
      },
    };

    expect(organicCopyToConfigBlock(copy).insOuts).toMatchObject({
      insLabel: 'IN',
      outsLabel: 'OUT',
    });
  });

  it('maps question-cta copy into the questionCta block', () => {
    const copy: GeneratedOrganicCopy = {
      kind: 'question-cta',
      config: {
        question: 'Thinking about lip filler?',
        ctaText: 'Read the caption ⬇',
      },
    };

    const block = organicCopyToConfigBlock(copy);

    expect(block).toEqual({
      questionCta: {
        question: 'Thinking about lip filler?',
        ctaText: 'Read the caption ⬇',
      },
    });
    expect(Object.keys(block)).toEqual(['questionCta']);
  });

  it('maps improves copy into the improves block', () => {
    const copy: GeneratedOrganicCopy = {
      kind: 'improves',
      config: {
        serviceName: 'Microneedling',
        items: ['Texture', 'Fine lines', 'Scarring'],
        ctaText: 'Book a consult',
      },
    };

    const block = organicCopyToConfigBlock(copy);

    expect(block).toEqual({
      improves: {
        serviceName: 'Microneedling',
        items: ['Texture', 'Fine lines', 'Scarring'],
        ctaText: 'Book a consult',
      },
    });
    expect(Object.keys(block)).toEqual(['improves']);
  });
});
