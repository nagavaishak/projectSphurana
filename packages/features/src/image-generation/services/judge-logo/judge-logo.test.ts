import { createAnthropicClient } from '@borradh-workspace/ai';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import sharp from 'sharp';
import { vi } from 'vitest';

// The service reaches `client.messages.create` two levels deep. Drive it via a
// stable `vi.fn()` rewired in `beforeEach` so behaviour is re-established per
// test (isolate-safe).
const mockMessagesCreate = vi.fn();

import { judgeLogo, logoCorrection } from './judge-logo.service.js';

const reply = (text: string) => ({ content: [{ type: 'text', text }] });

/** The service makes TWO calls: locate the mark, then compare it. */
const stages = (locate: string, judge: string) => {
  mockMessagesCreate
    .mockResolvedValueOnce(reply(locate))
    .mockResolvedValueOnce(reply(judge));
};

/** A mark found in the top-left eighth — big enough in a 400x500 png to crop. */
const FOUND = '{"count":1,"box":{"x":0.1,"y":0.05,"w":0.4,"h":0.15}}';
const NOT_FOUND = '{"count":0,"box":{"x":0,"y":0,"w":0,"h":0}}';

/** A real PNG — the service runs both images through sharp and crops one. */
const png = async (width = 400, height = 500) =>
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 120, b: 90 },
    },
  })
    .png()
    .toBuffer();

describe('judgeLogo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createAnthropicClient).mockReturnValue({
      messages: { create: mockMessagesCreate },
    } as never);
  });

  it('passes a matching mark', async () => {
    stages(FOUND, '{"verdict":"correct","note":""}');
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe('correct');
      expect(result.data.isDefect).toBe(false);
    }
  });

  it('catches a re-typeset mark — the defect the general gate missed', async () => {
    stages(
      FOUND,
      '{"verdict":"re-typeset","note":"business name in a plain serif, no leaf icon"}'
    );
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe('re-typeset');
      expect(result.data.isDefect).toBe(true);
      expect(result.data.note).toContain('leaf');
    }
  });

  it('catches a SUBSTITUTED emblem — right name, wrong icon', async () => {
    // The hole this verdict fills. A circle of leaves where the real mark is a
    // butterfly in a rounded square passed as `correct`, because the taxonomy
    // had no name for "the icon is a different drawing" and the tie-break
    // pushed it to correct. It shipped, and would not have been re-rendered.
    stages(
      FOUND,
      '{"verdict":"substituted","note":"circular leaf emblem, not the butterfly"}'
    );
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.verdict).toBe('substituted');
      expect(result.data.isDefect).toBe(true);
    }
  });

  it('treats an unrecognised verdict as correct rather than a defect', async () => {
    // This judgement triggers a re-render. A parse slip must never cost a
    // second image call on a graphic that was fine.
    stages(FOUND, '{"verdict":"maybe-wrong","note":"unsure"}');
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isDefect).toBe(false);
  });

  it('returns an error, NOT a defect, when the reply has no JSON', async () => {
    // Fails open: callers treat `err` as "no opinion", never as "reject".
    stages(FOUND, 'I cannot tell.');
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(),
    });
    expect(result.success).toBe(false);
  });

  it('returns an error when the model call throws', async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error('502'));
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(),
    });
    expect(result.success).toBe(false);
  });

  it('crops the mark and tells the judge it is looking at a crop', async () => {
    // The point of the two stages. Judging the whole graphic put the emblem at
    // ~1% of the pixels and a substituted mark scored `correct`.
    stages(FOUND, '{"verdict":"correct","note":""}');
    await judgeLogo({ png: await png(), brandLogo: await png(120, 120) });

    const compare = mockMessagesCreate.mock.calls[1][0];
    const labels = compare.messages[0].content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text);
    expect(labels.join(' ')).toContain('cropped and enlarged');
  });

  it('falls back to the whole graphic when the mark cannot be located', async () => {
    // A failed localisation must never be worse than the old behaviour.
    stages(NOT_FOUND, '{"verdict":"correct","note":""}');
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(120, 120),
    });

    const compare = mockMessagesCreate.mock.calls[1][0];
    const labels = compare.messages[0].content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text);
    expect(labels.join(' ')).toContain('The generated graphic');
    expect(result.success).toBe(true);
  });

  it('falls back when the box is too small to be a real crop', async () => {
    stages(
      '{"count":1,"box":{"x":0.5,"y":0.5,"w":0.001,"h":0.001}}',
      '{"verdict":"correct","note":""}'
    );
    await judgeLogo({ png: await png(), brandLogo: await png(120, 120) });
    const compare = mockMessagesCreate.mock.calls[1][0];
    const labels = compare.messages[0].content
      .filter((c: { type: string }) => c.type === 'text')
      .map((c: { text: string }) => c.text);
    expect(labels.join(' ')).toContain('The generated graphic');
  });

  it('reports duplicated without cropping when two marks are found', async () => {
    // Cropping "the largest" would hide the second one.
    mockMessagesCreate.mockResolvedValueOnce(
      reply('{"count":2,"box":{"x":0.1,"y":0.1,"w":0.2,"h":0.1}}')
    );
    const result = await judgeLogo({
      png: await png(),
      brandLogo: await png(120, 120),
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.verdict).toBe('duplicated');
    expect(mockMessagesCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects input with no logo to compare against', async () => {
    const result = await judgeLogo({
      png: await png(),
    } as never);
    expect(result.success).toBe(false);
  });
});

describe('logoCorrection', () => {
  it('says nothing for a correct mark', () => {
    expect(
      logoCorrection({ verdict: 'correct', note: '', isDefect: false })
    ).toBeNull();
  });

  it('tells the model what to DO, not that it was wrong', () => {
    // "The logo is wrong" re-samples the same distribution. The correction has
    // to name the action that makes the second attempt different.
    const c = logoCorrection({
      verdict: 're-typeset',
      note: '',
      isDefect: true,
    });
    expect(c).toContain('Reproduce the supplied LOGO image');
    expect(c).toContain('Do not set the name in any font');
  });

  it('tells the model to reproduce the icon, not just the name', () => {
    const c = logoCorrection({
      verdict: 'substituted',
      note: '',
      isDefect: true,
    });
    expect(c).toContain('SUBSTITUTED');
    expect(c).toContain('Do not invent a badge, circle, ring or motif');
  });

  it('gives each failure its own instruction', () => {
    const seen = new Set(
      (
        [
          're-typeset',
          'substituted',
          'distorted',
          'recoloured-container',
          'absent',
          'duplicated',
        ] as const
      ).map((verdict) => logoCorrection({ verdict, note: '', isDefect: true }))
    );
    expect(seen.size).toBe(6);
  });
});
