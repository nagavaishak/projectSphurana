import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type GraphicPrompt,
  isEmptyCopy,
  serialiseGraphicPrompt,
} from './graphic-prompt.js';

const prompt = (over: Partial<GraphicPrompt> = {}): GraphicPrompt => ({
  directives: ['Produce EXACTLY ONE slide.'],
  copy: null,
  ...over,
});

describe('serialiseGraphicPrompt', () => {
  it('puts renderable copy in its own delimited block', () => {
    const out = serialiseGraphicPrompt(
      prompt({ copy: { heading: 'Cryotherapy', body: 'Twenty minutes.' } })
    );
    expect(out).toContain('=== COPY TO RENDER ===');
    expect(out).toContain('HEADING: Cryotherapy');
    expect(out).toContain('BODY: Twenty minutes.');
    expect(out).toContain('=== END COPY ===');
  });

  it('keeps a slide-position directive OUT of the copy block', () => {
    // The whole point. "This is slide 4 of 7" used to be concatenated onto the
    // copy, and the model periodically drew `Slide 4/7` onto the canvas.
    const out = serialiseGraphicPrompt(
      prompt({
        directives: ['This is slide 4 of 7 in ONE coherent carousel.'],
        copy: { raw: 'Myth: it hurts.' },
      })
    );
    const copyBlock = out.slice(out.indexOf('=== COPY TO RENDER ==='));
    expect(copyBlock).toContain('Myth: it hurts.');
    expect(copyBlock).not.toContain('slide 4 of 7');
  });

  it('states the channel rule whenever there is copy to render', () => {
    const out = serialiseGraphicPrompt(prompt({ copy: { raw: 'Hello' } }));
    expect(out).toContain('must NEVER be drawn as words');
    expect(out).toContain('do not add slide numbers');
  });

  it('forbids inventing copy when none was planned', () => {
    const out = serialiseGraphicPrompt(prompt());
    expect(out).toContain('No copy has been planned');
    expect(out).not.toContain('=== COPY TO RENDER ===');
  });

  it('treats an all-empty copy object as no copy at all', () => {
    // A planner that returns blank strings must not open an empty block the
    // model then feels obliged to fill.
    expect(isEmptyCopy({ heading: '  ', body: '' })).toBe(true);
    const out = serialiseGraphicPrompt(prompt({ copy: { heading: '  ' } }));
    expect(out).not.toContain('=== COPY TO RENDER ===');
  });

  it('drops blank directives rather than leaving double spaces', () => {
    const out = serialiseGraphicPrompt(
      prompt({ directives: ['One.', '', '   ', 'Two.'] })
    );
    expect(out).toContain('One. Two.');
  });

  /**
   * The assembled prompt as a VALUE, pinned.
   *
   * The most expensive mistake in this area was four rewordings of an
   * instruction about images that were never being sent, because nobody had
   * read the whole prompt. A snapshot means any change to what the model
   * actually receives shows up in a diff instead of in a render three days
   * later.
   */
  it('assembles the full prompt in a stable, reviewable shape', () => {
    const out = serialiseGraphicPrompt({
      directives: [
        'Produce EXACTLY ONE slide as a single full-frame composition.',
        'This is slide 2 of 5 in ONE coherent carousel (role: myth).',
        'Provided images, in order — image 1 is the brand LOGO.',
      ],
      copy: {
        heading: 'Myth: lasers hurt',
        body: 'Most clients describe a warm flick.',
        cta: 'Book a patch test',
        footer: '@clinic',
      },
    });
    expect(out).toMatchInlineSnapshot(`
      "Produce EXACTLY ONE slide as a single full-frame composition. This is slide 2 of 5 in ONE coherent carousel (role: myth). Provided images, in order — image 1 is the brand LOGO.

      EVERYTHING ABOVE is instruction about HOW to build this graphic — it describes the render and must NEVER be drawn as words, numbers or labels in the artwork. The ONLY text that may appear in the finished image is the text between === COPY TO RENDER === and === END COPY === below. Render those strings exactly as written, including their spelling and capitalisation; do not add slide numbers, role names, section headings, field labels, or any other words of your own.

      === COPY TO RENDER ===
      HEADING: Myth: lasers hurt
      BODY: Most clients describe a warm flick.
      CTA: Book a patch test
      FOOTER: @clinic
      === END COPY ==="
    `);
  });
});

describe('the service record never becomes copy', () => {
  it('keeps a CONTEXT directive out of the copy block', () => {
    // A single rendered `Service: Extra Large Area - Laser Single Session |
    // Female` — label, pipe and category suffix — on all four images of a
    // batch. The service record is a CRM row, not a headline.
    const out = serialiseGraphicPrompt({
      directives: [
        'CONTEXT — describes what this graphic is about, and is never itself text to draw: the business offers a service internally recorded as "Extra Large Area - Laser Single Session | Female".',
      ],
      copy: { heading: 'Laser hair removal' },
    });
    const copyBlock = out.slice(out.indexOf('=== COPY TO RENDER ==='));
    expect(copyBlock).toContain('Laser hair removal');
    expect(copyBlock).not.toContain('Service:');
    expect(copyBlock).not.toContain('| Female');
  });
});

describe('the reference is the design model, not just a palette', () => {
  it('asks for composition and scale, and forbids taking the words', () => {
    // With one reference and no template the model lifted the reference's
    // headline verbatim — "3 Things You Need to Know" over a list of two —
    // while taking none of its composition. The directive has to demand the
    // structure and refuse the copy.
    const directive =
      'THE BRAND EXAMPLE POST IS YOUR DESIGN MODEL — treat it the way a designer treats a previous piece in the same series. Build this graphic in ITS design language: divide the canvas the same way, use the same kind of hierarchy and the same scale relationships (how much bigger the headline is than the body, how small the mark sits), match how dense or airy it is, treat any photograph the way it treats one — cropped, bled off an edge, framed, or absent — and reuse its structural devices such as panels, rules, oversized numerals or framing shapes. Give this graphic ONE dominant element and ONE message, as it does. What you must NOT take from it: its words, its headline, its numbers, its claims and its photograph — those belong to that post, not this one.';

    const out = serialiseGraphicPrompt({
      directives: [directive],
      copy: { heading: 'Laser hair removal' },
    });

    // Composition is demanded...
    expect(out).toContain('scale relationships');
    expect(out).toContain('ONE dominant element');
    // ...the reference's copy is refused...
    expect(out).toContain('its words, its headline, its numbers');
    // ...and it names no colour, typeface or shape of its own, which would put
    // it in competition with the reference it is pointing at.
    expect(directive).not.toMatch(/serif|sans|#[0-9a-f]{6}|gold|cream/i);

    // And it stays a directive: none of it may be drawn.
    const copyBlock = out.slice(out.indexOf('=== COPY TO RENDER ==='));
    expect(copyBlock).not.toContain('DESIGN MODEL');
  });
});
