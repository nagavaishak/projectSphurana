import { readFileSync } from 'node:fs';
import path from 'node:path';
// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import {
  MAX_GENERATION_ATTEMPTS,
  createMetaAdsPort,
  toAdCopyBlockedReason,
  toAdUpdateBlockedReason,
  toBudgetBlockedReasonFromCode,
} from './meta-ads.adapter.js';

// `meta-ads.adapter.ts` now calls `updateCampaign` directly instead of going
// through the loopback (phase 4, step 4). That import drags the Meta
// integration graph — `packages/integrations` — into this unit test's module
// graph, and the api jest transform cannot load its ESM. Stubbing the use case
// keeps the unit tests about the ADAPTER's mapping; the real call is covered by
// `_integration/tool-meta-ads-budget.int-spec.ts`.
// The adapter now imports `db` to call the use case directly (phase 4, step
// 4). The database barrel is ESM in dist and the api jest transform cannot
// load it; the adapter never touches `db` itself, it only forwards it.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/meta-campaigns', () => ({
  updateCampaign: jest.fn(async () => ({
    success: true,
    data: { updated: true },
  })),
}));

// The D2b validator is the one production import this adapter makes. Mocked
// so the spec doesn't boot the whole `features/assistant` barrel; individual
// tests override the implementation.
jest.mock('@borradh-workspace/features/assistant', () => ({
  validateGeneratedCopy: jest.fn(() => []),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateGeneratedCopy } = jest.requireMock(
  '@borradh-workspace/features/assistant'
) as { validateGeneratedCopy: jest.Mock };

const VIDEO_ID = 'vid-1';
const AD_ID = 'ad-9';

function portWith(apiFetch: jest.Mock) {
  return createMetaAdsPort({ apiFetch: apiFetch as unknown as ApiFetchFn });
}

/**
 * Read a message constant out of the update-ad service SOURCE rather than
 * importing it. Same reasoning as `videos.adapter.spec.ts`: importing
 * `@borradh-workspace/features/meta-ads` drags the Meta SDK and the whole
 * barrel into this spec. A static read keeps the copies pinned without the
 * dependency — reword the service message and this fails instead of silently
 * degrading `saved_but_not_synced` to a flat `blocked`.
 */
function updateAdServiceSource(): string {
  return readFileSync(
    path.resolve(
      __dirname,
      '../../../../../packages/features/src/meta-ads/services/update-ad/update-ad.service.ts'
    ),
    'utf8'
  );
}

/** The wire shape of `POST /ai-content/generate` — copy nested under `content`. */
function adCopyResponse(content: Record<string, string>) {
  return { contentType: 'ad', content };
}

describe('meta ads port adapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    validateGeneratedCopy.mockImplementation(() => []);
  });

  describe('updateBudget — migrated to the use case (phase 4, step 4)', () => {
    // The HTTP-status mapper is GONE with the loopback hop. Reasons now come
    // from the typed FeatureError code the use case raises, instead of being
    // reconstructed from a status and a sanitised sentence. That reconstruction
    // is the tax the doc calls out; this is what removing it looks like.
    it('maps NOT_FOUND to campaign_not_found', () => {
      expect(toBudgetBlockedReasonFromCode('NOT_FOUND', 'gone', 'c-1')).toEqual(
        { kind: 'campaign_not_found', metaCampaignId: 'c-1' }
      );
    });

    it('maps INTERNAL_ERROR to server_error, not to a refusal', () => {
      expect(
        toBudgetBlockedReasonFromCode('INTERNAL_ERROR', 'boom', 'c-1')
      ).toEqual({ kind: 'server_error', message: 'boom' });
    });

    it('carries an unrecognised code through verbatim rather than guessing', () => {
      expect(
        toBudgetBlockedReasonFromCode('SOMETHING_NEW', 'nope', 'c-1')
      ).toEqual({ kind: 'other', message: 'nope' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // generateAdCopy
  // ──────────────────────────────────────────────────────────────────────────

  describe('generateAdCopy', () => {
    it('reads the copy from `content`, where the API actually puts it', async () => {
      // THE defect. The tool this replaced read `data.headline` at the TOP
      // level of the response; `generateContent` returns
      // `{ contentType, content: { headline, … } }`. Every field was
      // `undefined`, so every call produced all-null copy with an OK status —
      // not a flaky generator, a mis-read envelope. Its sibling tools
      // (`generatePostCaption`, `content-tools`) read `content.*` correctly.
      const apiFetch = jest.fn(async () =>
        adCopyResponse({
          headline: 'Foundation creasing by lunchtime?',
          primaryText: 'A skin-smoothing facial. Just €49. Message us to book.',
          description: 'Book today',
          callToAction: 'BOOK_NOW',
        })
      );

      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });

      expect(result.status).toBe('generated');
      if (result.status === 'generated') {
        expect(result.copy.headline).toBe('Foundation creasing by lunchtime?');
        expect(result.copy.primaryText).toContain('skin-smoothing facial');
        expect(result.attempts).toBe(1);
      }
    });

    it('POSTs the ad content-type request the endpoint expects', async () => {
      const apiFetch = jest.fn(async () =>
        adCopyResponse({ headline: 'H', primaryText: 'P' })
      );
      await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
        serviceIds: ['svc-1'],
        includeOffer: true,
      });

      const [calledPath, opts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('ai-content/generate');
      expect(opts.method).toBe('POST');
      expect(opts.body).toEqual({
        mediaType: 'video',
        mediaId: VIDEO_ID,
        contentType: 'ad',
        serviceIds: ['svc-1'],
        includeOffer: true,
      });
    });

    it('refuses to call a top-level (un-nested) response `generated`', async () => {
      // The exact payload the old code was written against. It must now be
      // read as "the generator returned nothing", never as copy.
      const apiFetch = jest.fn(async () => ({
        headline: 'Foundation creasing by lunchtime?',
        primaryText: 'A skin-smoothing facial.',
      }));

      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });

      expect(result).toEqual({
        status: 'blocked',
        reason: { kind: 'empty_copy', missing: ['headline', 'primaryText'] },
      });
      // No retry: an empty envelope is not a content problem.
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    it('treats blank headline/primaryText as empty_copy, not success', async () => {
      const apiFetch = jest.fn(async () =>
        adCopyResponse({ headline: '   ', primaryText: 'P', description: '' })
      );
      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });
      expect(result).toEqual({
        status: 'blocked',
        reason: { kind: 'empty_copy', missing: ['headline'] },
      });
    });

    it('allows an empty description — the matched-caption path has none', async () => {
      const apiFetch = jest.fn(async () =>
        adCopyResponse({
          headline: 'Dull skin?',
          primaryText: 'Brightening facial. Message us to book.',
          description: '',
          callToAction: 'CONTACT_US',
        })
      );
      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });
      expect(result.status).toBe('generated');
      if (result.status === 'generated') {
        expect(result.copy.description).toBe('');
        expect(result.copy.callToAction).toBe('CONTACT_US');
      }
    });

    it('defaults the CTA button when the response omits it', async () => {
      const apiFetch = jest.fn(async () =>
        adCopyResponse({ headline: 'H', primaryText: 'P' })
      );
      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });
      if (result.status === 'generated') {
        expect(result.copy.callToAction).toBe('BOOK_NOW');
      }
    });

    it('regenerates past a hard-blocked generation and returns the clean one', async () => {
      const apiFetch = jest
        .fn()
        .mockResolvedValueOnce(
          adCopyResponse({
            headline: 'Dull skin?',
            primaryText: 'Brightening facial. 20% off this week.',
          })
        )
        .mockResolvedValueOnce(
          adCopyResponse({
            headline: 'Dull skin?',
            primaryText: 'Brightening facial. Just €49.',
          })
        );
      validateGeneratedCopy.mockImplementation(
        (payload: Record<string, string>) =>
          /\d+\s*%/.test(Object.values(payload).join(' '))
            ? [
                {
                  field: 'primaryText',
                  reason: 'percent_claim',
                  matched: '20%',
                },
              ]
            : []
      );

      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });

      expect(apiFetch).toHaveBeenCalledTimes(2);
      expect(result.status).toBe('generated');
      if (result.status === 'generated') {
        expect(result.copy.primaryText).toBe('Brightening facial. Just €49.');
        expect(result.attempts).toBe(2);
      }
    });

    it('ignores non-hard-block validator failures', async () => {
      const apiFetch = jest.fn(async () =>
        adCopyResponse({ headline: 'H', primaryText: 'P' })
      );
      validateGeneratedCopy.mockImplementation(() => [
        { field: 'headline', reason: 'some_soft_advisory' },
      ]);
      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });
      expect(result.status).toBe('generated');
      expect(apiFetch).toHaveBeenCalledTimes(1);
    });

    it('reports exhausted content-rule retries as its own outcome, not a failure', async () => {
      // An API failure and "your ask keeps tripping a content rule" are
      // different events with different remedies. `blocked` would collapse them
      // and the owner would never learn which.
      const apiFetch = jest.fn(async () =>
        adCopyResponse({
          headline: 'Dull skin?',
          primaryText: 'Brightening facial. 20% off.',
        })
      );
      validateGeneratedCopy.mockImplementation(() => [
        { field: 'primaryText', reason: 'percent_claim', matched: '20%' },
      ]);

      const result = await portWith(apiFetch).generateAdCopy({
        videoId: VIDEO_ID,
      });

      expect(apiFetch).toHaveBeenCalledTimes(MAX_GENERATION_ATTEMPTS);
      expect(result.status).toBe('rejected_by_content_rules');
      if (result.status === 'rejected_by_content_rules') {
        expect(result.attempts).toBe(MAX_GENERATION_ATTEMPTS);
        expect(result.violations).toEqual([
          { field: 'primaryText', reason: 'percent_claim', matched: '20%' },
        ]);
      }
      // There is no member of this union that could carry copy here.
      expect(JSON.stringify(result)).not.toContain('headline');
    });

    it('maps a 404 to media_not_found', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValue(new ApiFetchError('Asset not found', 404));
      expect(
        await portWith(apiFetch).generateAdCopy({ videoId: VIDEO_ID })
      ).toEqual({
        status: 'blocked',
        reason: { kind: 'media_not_found', mediaId: VIDEO_ID },
      });
    });

    it('maps a 429 to rate_limited', () => {
      expect(
        toAdCopyBlockedReason(new ApiFetchError('Slow down', 429), VIDEO_ID)
      ).toEqual({ kind: 'rate_limited', message: 'Slow down' });
    });

    it('separates a stated 4xx refusal from a server fault', () => {
      // Callers alert on `server_error` and stay quiet on `other`; collapsing
      // the two is what made ordinary "no, because…" answers page someone
      // (API-9G / ENG-402).
      expect(
        toAdCopyBlockedReason(new ApiFetchError('Bad request', 400), VIDEO_ID)
      ).toEqual({ kind: 'other', message: 'Bad request' });
      expect(
        toAdCopyBlockedReason(new ApiFetchError('Boom', 500), VIDEO_ID)
      ).toEqual({ kind: 'server_error', message: 'Boom' });
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // updateAd
  // ──────────────────────────────────────────────────────────────────────────

  describe('updateAd', () => {
    const row = {
      id: AD_ID,
      name: 'Lip filler — March',
      status: 'draft',
      headline: 'New headline',
      primaryText: null,
      description: null,
      callToAction: 'BOOK_NOW',
      destinationUrl: null,
      videoId: 'v-1',
      graphicId: null,
    };

    it('PUTs to meta-ads/:id with the ad id out of the body', async () => {
      const apiFetch = jest.fn(async () => row);
      await portWith(apiFetch).updateAd({
        adId: AD_ID,
        headline: 'New headline',
      });

      const [calledPath, opts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe(`meta-ads/${AD_ID}`);
      expect(opts.method).toBe('PUT');
      expect(opts.body).toEqual({ headline: 'New headline' });
      expect(opts.body).not.toHaveProperty('adId');
    });

    it('names the fields the SERVER confirmed, read back from the response', async () => {
      const apiFetch = jest.fn(async () => row);
      const result = await portWith(apiFetch).updateAd({
        adId: AD_ID,
        headline: 'New headline',
        callToAction: 'BOOK_NOW',
      });

      expect(result.status).toBe('updated');
      if (result.status === 'updated') {
        expect(result.updated).toEqual(['headline', 'callToAction']);
        expect(result.ad.headline).toBe('New headline');
      }
    });

    it('reports a field the response did not echo back as unchanged', async () => {
      // The old tool built its result card from the REQUEST, so a field the
      // write never applied still printed as changed. There is no member of
      // this union that can say "updated" about a value the server did not
      // return.
      const apiFetch = jest.fn(async () => ({
        ...row,
        primaryText: 'the old caption',
      }));

      const result = await portWith(apiFetch).updateAd({
        adId: AD_ID,
        headline: 'New headline',
        primaryText: 'a brand new caption',
      });

      expect(result.status).toBe('partially_updated');
      if (result.status === 'partially_updated') {
        expect(result.updated).toEqual(['headline']);
        expect(result.unchanged).toEqual(['primaryText']);
      }
    });

    it('maps a 404 to ad_not_found and writes nothing', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValue(new ApiFetchError('Ad not found', 404));
      expect(
        await portWith(apiFetch).updateAd({ adId: AD_ID, headline: 'x' })
      ).toEqual({
        status: 'blocked',
        adId: AD_ID,
        reason: { kind: 'ad_not_found', adId: AD_ID },
      });
    });

    describe('post-write refusals', () => {
      // These three are raised AFTER `updateAdImpl` has already run its
      // `db.update(metaAd)`. The local draft changed and the live ad did not —
      // reporting a flat failure loses the first half.
      const cases: [string, string][] = [
        [
          'Cannot update creative fields on an ad created from an existing post. Only the ad name can be changed.',
          'creative_locked_to_existing_post',
        ],
        [
          'Cannot update creative for this ad. Media references are missing.',
          'creative_media_missing',
        ],
      ];

      it.each(cases)('%s → saved_but_not_synced', async (message, kind) => {
        const apiFetch = jest
          .fn()
          .mockRejectedValue(new ApiFetchError(message, 422));
        const result = await portWith(apiFetch).updateAd({
          adId: AD_ID,
          headline: 'x',
          primaryText: 'y',
        });

        expect(result.status).toBe('saved_but_not_synced');
        if (result.status === 'saved_but_not_synced') {
          expect(result.reason.kind).toBe(kind);
          expect(result.requested).toEqual(['headline', 'primaryText']);
        }
      });

      it('still matches the service messages they were copied from', () => {
        const source = updateAdServiceSource();
        for (const [message] of cases) {
          expect(source).toContain(message);
        }
        expect(source).toContain('Cannot update a rejected ad.');
      });

      it('treats a Meta sync failure as saved-but-not-synced too', async () => {
        // `updateAdImpl`'s catch block explicitly "keeps DB changes (user's
        // intent)" and records the sync error.
        const apiFetch = jest
          .fn()
          .mockRejectedValue(
            new ApiFetchError('Failed to sync ad update to Meta', 422)
          );
        const result = await portWith(apiFetch).updateAd({
          adId: AD_ID,
          headline: 'x',
        });
        expect(result.status).toBe('saved_but_not_synced');
      });
    });

    it('does NOT claim a write happened for a rejected ad (pre-write refusal)', async () => {
      const apiFetch = jest
        .fn()
        .mockRejectedValue(
          new ApiFetchError(
            'Cannot update a rejected ad. Please create a new ad.',
            400
          )
        );
      const result = await portWith(apiFetch).updateAd({
        adId: AD_ID,
        headline: 'x',
      });
      expect(result.status).toBe('blocked');
      if (result.status === 'blocked') {
        expect(result.reason).toEqual({ kind: 'ad_rejected' });
      }
    });

    it('does NOT claim a write happened for an unattributable fault', async () => {
      // A 500 could have landed before or after the db.update. The port has no
      // way to know, so it must not assert either — `blocked` is the honest
      // answer, and only this kind reaches Sentry.
      const result = toAdUpdateBlockedReason(new Error('Boom'), AD_ID);
      expect(result).toEqual({ kind: 'server_error', message: 'Boom' });
    });

    it('keeps an unrecognised 4xx refusal as `other` with the server wording', () => {
      expect(
        toAdUpdateBlockedReason(
          new ApiFetchError('Headline too long', 400),
          AD_ID
        )
      ).toEqual({ kind: 'other', message: 'Headline too long' });
    });

    it('has no way to accept targeting — the parameter is gone', async () => {
      const apiFetch = jest.fn(async () => row);
      await portWith(apiFetch).updateAd({
        adId: AD_ID,
        headline: 'New headline',
      });
      const [, opts] = apiFetch.mock.calls[0] as [
        string,
        { body?: Record<string, unknown> },
      ];
      expect(opts.body).not.toHaveProperty('targetingOverride');
    });
  });
});
