import { describe, expect, it } from '@borradh-workspace/testing';
import {
  activeTemplateKey,
  templateTextFields,
} from './template-text-fields.js';

/**
 * The words on a video, as text.
 *
 * This is what makes "change point 3" answerable. In an ordinary chat the copy
 * arrives in the transcript when the video is made; a queued post has no such
 * turn, and without this the only honest reply was to ask the owner what point
 * 3 said while they were looking straight at it.
 *
 * The NARROWING is the load-bearing part. A draft carries plenty of objects
 * that are not copy — captions, outro, colours, timings — and a model told to
 * "change the text" that could reach them would break the render rather than
 * the wording.
 */
describe('activeTemplateKey', () => {
  it('finds the populated template block', () => {
    expect(
      activeTemplateKey({
        numberedList: { title: 'Three steps', items: ['One'] },
      } as never)
    ).toBe('numberedList');
  });

  // A draft always has captions and an outro. Neither is a template.
  it('ignores blocks that are not templates', () => {
    expect(
      activeTemplateKey({
        captions: { enabled: true, position: 'bottom' },
        outro: { enabled: true },
      } as never)
    ).toBeNull();
  });

  it('returns null for a draft with no template block at all', () => {
    expect(activeTemplateKey({ scriptText: 'A script.' } as never)).toBeNull();
  });

  it('survives a missing draft config', () => {
    expect(activeTemplateKey(null)).toBeNull();
    expect(activeTemplateKey(undefined)).toBeNull();
  });
});

describe('templateTextFields', () => {
  it('lists the copy on the active template', () => {
    expect(
      templateTextFields({
        numberedList: { title: 'Three steps', items: ['One', 'Two'] },
      } as never)
    ).toEqual({ title: 'Three steps', items: ['One', 'Two'] });
  });

  // Mechanics are not copy. `secondsPerLine` rewritten as a sentence is a
  // broken render, not a reworded one.
  it('leaves numbers and colours out', () => {
    expect(
      templateTextFields({
        fadeBenefits: {
          lines: ['Softer skin', 'Fewer lines'],
          secondsPerLine: 2.5,
          primaryColor: '#FFD700',
          enabled: true,
        },
      } as never)
    ).toEqual({
      lines: ['Softer skin', 'Fewer lines'],
      primaryColor: '#FFD700',
    });
  });

  // A mixed array is not copy either — half-rewriting one is worse than
  // refusing it.
  it('leaves an array that is not all strings out', () => {
    expect(
      templateTextFields({
        mythFact: { pairs: [{ myth: 'a', fact: 'b' }], seriesTitle: 'Myths' },
      } as never)
    ).toEqual({ seriesTitle: 'Myths' });
  });

  it('returns nothing for a draft with no template block', () => {
    expect(templateTextFields({ scriptText: 'A script.' } as never)).toEqual(
      {}
    );
    expect(templateTextFields(null)).toEqual({});
  });

  // The Caption Tease trap, in data. `headline` is the big line the owner is
  // looking at; `caption` is a small cursive hook underneath. Both are listed,
  // which is what lets the classifier tell them apart — asked to "change the
  // caption", it patched the wrong one for weeks.
  it('lists a Caption Tease’s headline and its caption separately', () => {
    expect(
      templateTextFields({
        captionTease: {
          headline: 'Transform your skin',
          emphasis: 'Transform',
          caption: 'check the caption',
        },
      } as never)
    ).toEqual({
      headline: 'Transform your skin',
      emphasis: 'Transform',
      caption: 'check the caption',
    });
  });
});
