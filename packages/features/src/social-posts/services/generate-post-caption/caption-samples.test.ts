import { describe, expect, it } from '@borradh-workspace/testing';
import { countHashtags, loadCaptionSamples } from './caption-samples.js';
import { buildPostCaptionPrompt } from './prompts.js';

interface Row {
  caption: string | null;
  postedAt: Date | null;
}

function dbWith(rows: Row[]) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => rows,
  };
  return chain as never;
}

const long = (prefix: string, tags = 3) =>
  `${prefix} — ${'we take our time with every client and explain each step. '.repeat(2)}${Array.from(
    { length: tags },
    (_, i) => `#tag${i}`
  ).join(' ')}`;

describe('countHashtags', () => {
  it('counts tags including accented characters', () => {
    expect(countHashtags('nice #beauté #skin and # stray')).toBe(2);
  });
});

describe('loadCaptionSamples', () => {
  it('drops link dumps and one-liners that carry no voice', async () => {
    const samples = await loadCaptionSamples(
      dbWith([
        { caption: 'Book now 👉 link in bio', postedAt: new Date() },
        { caption: '💫💫💫', postedAt: new Date() },
        { caption: long('Powder brows'), postedAt: new Date() },
      ]),
      'org-1'
    );
    expect(samples.captions).toHaveLength(1);
    expect(samples.captions[0]).toContain('Powder brows');
  });

  // A post published to both Facebook and Instagram is stored twice with an
  // identical caption. Eight samples that are really four posts twice over is a
  // much weaker voice signal than it looks.
  it('deduplicates the same caption published to two platforms', async () => {
    const caption = long('Laser hair removal');
    const samples = await loadCaptionSamples(
      dbWith([
        { caption, postedAt: new Date() },
        { caption, postedAt: new Date() },
        { caption: long('Dermaplaning'), postedAt: new Date() },
      ]),
      'org-1'
    );
    expect(samples.captions).toHaveLength(2);
  });

  it("measures the org's own hashtag and length habits", async () => {
    const samples = await loadCaptionSamples(
      dbWith([
        { caption: long('A', 10), postedAt: new Date() },
        { caption: long('B', 10), postedAt: new Date() },
      ]),
      'org-1'
    );
    expect(samples.averageHashtagCount).toBe(10);
    expect(samples.averageLength).toBeGreaterThan(80);
  });

  it('returns nulls, not zeroes, when there is nothing to measure', async () => {
    const samples = await loadCaptionSamples(dbWith([]), 'org-1');
    expect(samples.captions).toEqual([]);
    // Null means "unknown" and lets the prompt keep its defaults; 0 would read
    // as "this business uses no hashtags".
    expect(samples.averageHashtagCount).toBeNull();
    expect(samples.averageLength).toBeNull();
  });
});

const IDEA = {
  topic: 'Powder brows aftercare',
  angle: 'Day three is when people panic',
  payoff: 'The flaking is normal and it passes',
  audience: 'Clients a few days post-treatment',
  serviceName: 'Powder Brows',
} as never;

describe('buildPostCaptionPrompt — seeding', () => {
  it('falls back to the described voice when there are no samples', () => {
    const { systemMessage, userMessage } = buildPostCaptionPrompt(
      IDEA,
      undefined,
      []
    );
    expect(systemMessage).toContain('Brand voice: warm, knowledgeable');
    expect(systemMessage).not.toContain('REAL CAPTIONS');
    expect(userMessage).toContain('3 to 5 hashtags');
    expect(userMessage).toContain('80 to 500 characters');
  });

  it('shows the real captions and drops the generic voice line', () => {
    const { systemMessage } = buildPostCaptionPrompt(IDEA, undefined, [], {
      captions: ['Their actual caption, in their actual voice.'],
      averageHashtagCount: 9,
      averageLength: 600,
    });
    expect(systemMessage).toContain('REAL CAPTIONS');
    expect(systemMessage).toContain('Their actual caption');
    // The described voice would compete with the demonstrated one.
    expect(systemMessage).not.toContain('Brand voice: warm, knowledgeable');
  });

  // The defaults are what made every business converge on the same shape.
  it("uses the org's own hashtag count and length instead of the defaults", () => {
    const { userMessage } = buildPostCaptionPrompt(IDEA, undefined, [], {
      captions: ['a caption'],
      averageHashtagCount: 9,
      averageLength: 600,
    });
    expect(userMessage).toContain('about 9 hashtags');
    expect(userMessage).not.toContain('3 to 5 hashtags');
    expect(userMessage).toContain('about 600 characters');
    expect(userMessage).not.toContain('80 to 500 characters');
  });

  it('singularises a one-hashtag habit', () => {
    const { userMessage } = buildPostCaptionPrompt(IDEA, undefined, [], {
      captions: ['a caption'],
      averageHashtagCount: 1,
      averageLength: 200,
    });
    expect(userMessage).toContain('about 1 hashtag (');
  });

  it('forbids a hashtag containing a space', () => {
    const { userMessage } = buildPostCaptionPrompt(IDEA);
    expect(userMessage).toContain('single unbroken token');
  });

  it("keeps the owner's explicit rules above the samples", () => {
    const { systemMessage } = buildPostCaptionPrompt(
      IDEA,
      undefined,
      ['Never mention price'],
      { captions: ['a caption'], averageHashtagCount: 4, averageLength: 300 }
    );
    expect(systemMessage).toContain('Never mention price');
    expect(systemMessage).toContain('these OVERRIDE anything below');
  });
});
