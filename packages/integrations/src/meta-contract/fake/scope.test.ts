import { describe, expect, it } from 'vitest';
import {
  GRAPH_API_BASE,
  INSTAGRAM_MESSAGING_API_BASE,
} from '../../shared/graph-api.js';
import { createMetaFakeInterceptor } from './index.js';

/**
 * SCOPE ROUTING — "fake the Marketing API, keep messaging real".
 *
 * The rate limiter and the fake have the same shape: error code 17 is a
 * MARKETING API limit, tripped by parallel ad publishes against one ad account.
 * Messenger's Send API and WhatsApp Cloud have separate, generous limits.
 *
 * So `marketing` scope fakes ads and lets messaging through — removing the
 * rate limiting without giving up real coverage of the delivery path, which is
 * the one that fails silently and the one Meta actually changes under us.
 *
 * Getting this routing wrong is the worst outcome available here: fake a
 * messaging call and the chatbot suite tests nothing while looking green; let
 * an ad publish through and the rate limiting comes straight back.
 */

const marketing = createMetaFakeInterceptor({ scope: 'marketing' });
const all = createMetaFakeInterceptor({ scope: 'all' });

const ACT = 'act_123456';
const PAGE = '987654321';

/** null = passed through to real Meta; a Response = served by the fake. */
async function routed(
  fake: ReturnType<typeof createMetaFakeInterceptor>,
  url: string,
  init: RequestInit = {}
): Promise<'faked' | 'real'> {
  const res = await fake(url, init);
  return res === null ? 'real' : 'faked';
}

const validCampaign = JSON.stringify({
  name: 'E2E',
  objective: 'OUTCOME_LEADS',
  status: 'PAUSED',
  special_ad_categories: [],
  buying_type: 'AUCTION',
  is_adset_budget_sharing_enabled: false,
});

describe('marketing scope — FAKED (this is what rate-limits us)', () => {
  it.each([
    [
      'create campaign',
      `${GRAPH_API_BASE}/${ACT}/campaigns`,
      'POST',
      validCampaign,
    ],
    [
      'create ad',
      `${GRAPH_API_BASE}/${ACT}/ads`,
      'POST',
      JSON.stringify({
        name: 'ad',
        adset_id: 'as1',
        creative: { creative_id: 'c1' },
        status: 'PAUSED',
      }),
    ],
    ['upload video', `${GRAPH_API_BASE}/${ACT}/advideos`, 'POST', undefined],
    ['upload image', `${GRAPH_API_BASE}/${ACT}/adimages`, 'POST', undefined],
    ['list ads', `${GRAPH_API_BASE}/${ACT}/ads`, 'GET', undefined],
    ['account insights', `${GRAPH_API_BASE}/${ACT}/insights`, 'GET', undefined],
    [
      'lead-gen form',
      `${GRAPH_API_BASE}/${PAGE}/leadgen_forms`,
      'POST',
      JSON.stringify({
        name: 'f',
        questions: '[]',
        privacy_policy: '{}',
      }),
    ],
  ])('%s', async (_label, url, method, body) => {
    expect(await routed(marketing, url, { method, body })).toBe('faked');
  });

  it.each(['camp-abc', 'adset-abc', 'ad-abc', 'creative-abc', 'form-abc'])(
    'node ops on a fake-minted id (%s)',
    async (id) => {
      // `/{id}` is shared between ad entities and page objects, so the PATH
      // can't discriminate — the id prefix does. Everything the fake mints is
      // prefixed; real Graph ids are numeric.
      expect(await routed(marketing, `${GRAPH_API_BASE}/${id}`)).toBe('faked');
      expect(
        await routed(marketing, `${GRAPH_API_BASE}/${id}`, { method: 'DELETE' })
      ).toBe('faked');
    }
  );
});

describe('marketing scope — REAL (the coverage worth keeping)', () => {
  it.each([
    [
      'Messenger send',
      `${GRAPH_API_BASE}/me/messages`,
      'POST',
      JSON.stringify({ recipient: { id: 'u' }, message: { text: 'hi' } }),
    ],
    [
      'Messenger conversations',
      `${GRAPH_API_BASE}/${PAGE}/conversations`,
      'GET',
      undefined,
    ],
    [
      'WhatsApp send',
      `${GRAPH_API_BASE}/5551234/messages`,
      'POST',
      JSON.stringify({
        messaging_product: 'whatsapp',
        to: '353',
        type: 'text',
        text: { body: 'hi' },
      }),
    ],
    [
      'WhatsApp templates',
      `${GRAPH_API_BASE}/waba/message_templates`,
      'GET',
      undefined,
    ],
    ['page feed publish', `${GRAPH_API_BASE}/${PAGE}/feed`, 'POST', undefined],
    [
      'page photo publish',
      `${GRAPH_API_BASE}/${PAGE}/photos`,
      'POST',
      undefined,
    ],
    [
      'page subscribe',
      `${GRAPH_API_BASE}/${PAGE}/subscribed_apps`,
      'POST',
      undefined,
    ],
    [
      'Instagram publish',
      `${INSTAGRAM_MESSAGING_API_BASE}/178414/media_publish`,
      'POST',
      undefined,
    ],
    [
      'Instagram sender profile',
      `${INSTAGRAM_MESSAGING_API_BASE}/555?fields=name,username`,
      'GET',
      undefined,
    ],
  ])('%s stays real', async (_label, url, method, body) => {
    expect(await routed(marketing, url, { method, body })).toBe('real');
  });

  it('a REAL (numeric) node id goes to real Meta', async () => {
    // The seedMetaAds page lookup and the post-exists check both use `/{id}`
    // with real ids — faking those would break the real chatbot binding.
    expect(
      await routed(
        marketing,
        `${GRAPH_API_BASE}/${PAGE}?fields=name,instagram_business_account{id}`
      )
    ).toBe('real');
  });

  it('an UNDECLARED endpoint passes through instead of failing', async () => {
    // OAuth is deliberately not in the registry. Under `marketing` that must
    // not fail a chatbot spec — real Meta is reachable, so pass it through.
    expect(
      await routed(marketing, `${GRAPH_API_BASE}/oauth/access_token`)
    ).toBe('real');
  });

  it('non-Graph traffic is untouched in every scope', async () => {
    for (const fake of [marketing, all]) {
      expect(await routed(fake, 'https://bucket.s3.amazonaws.com/k')).toBe(
        'real'
      );
    }
  });
});

describe('all scope — nothing escapes', () => {
  it('fakes messaging too', async () => {
    expect(
      await routed(all, `${GRAPH_API_BASE}/me/messages`, {
        method: 'POST',
        body: JSON.stringify({
          recipient: { id: 'u' },
          message: { text: 'hi' },
        }),
      })
    ).toBe('faked');
  });

  it('still HARD FAILS on an undeclared endpoint', async () => {
    // No real Meta to fall back to here, so silence would mean escaping.
    await expect(
      all(`${GRAPH_API_BASE}/oauth/access_token`, {})
    ).rejects.toThrow(/Unknown Graph endpoint/);
  });
});
