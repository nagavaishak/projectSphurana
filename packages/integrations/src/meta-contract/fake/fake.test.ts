import { describe, expect, it, vi } from 'vitest';
import { GRAPH_API_BASE } from '../../shared/graph-api.js';
import * as s from '../schemas.js';
import {
  MAGIC_IDS,
  MetaContractError,
  createMetaFakeInterceptor,
} from './index.js';

const ACT = 'act_123456';
const PAGE = '987654321';
const fake = createMetaFakeInterceptor();

async function call(
  url: string,
  init: RequestInit = {}
): Promise<{ status: number; body: unknown }> {
  const res = await fake(url, init);
  if (!res) throw new Error('fake returned null (expected a response)');
  return { status: res.status, body: await res.json() };
}

const validCampaign = JSON.stringify({
  name: 'E2E Campaign',
  objective: 'OUTCOME_LEADS',
  status: 'PAUSED',
  special_ad_categories: [],
  buying_type: 'AUCTION',
  is_adset_budget_sharing_enabled: false,
});

describe('pass-through', () => {
  it('ignores every non-Graph host', async () => {
    // The fake must not swallow S3/CDN/Remotion/OpenAI traffic — those are our
    // own infrastructure and the E2E suite depends on them working for real.
    for (const url of [
      'https://bucket.s3.eu-west-1.amazonaws.com/video.mp4',
      'https://cdn.borradh.io/asset.jpg',
      'https://api.openai.com/v1/chat/completions',
      'https://api.stripe.com/v1/charges',
    ]) {
      expect(await fake(url, { method: 'POST' })).toBeNull();
    }
  });
});

describe('loud failures', () => {
  it('throws on an undeclared Graph endpoint instead of hitting real Meta', async () => {
    await expect(
      call(`${GRAPH_API_BASE}/${ACT}/somethingnew`, { method: 'POST' })
    ).rejects.toThrow(MetaContractError);

    await expect(
      call(`${GRAPH_API_BASE}/${ACT}/somethingnew`, { method: 'POST' })
    ).rejects.toThrow(
      /Unknown Graph endpoint: POST \/act_123456\/somethingnew/
    );
  });

  it('throws on an unknown key — the "added a parameter" detector', async () => {
    const body = JSON.parse(validCampaign);
    body.brand_new_param = 'oops';

    await expect(
      call(`${GRAPH_API_BASE}/${ACT}/campaigns`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    ).rejects.toThrow(/Request contract violation on ads\.createCampaign/);
  });

  it('names the offending key so the fix is obvious', async () => {
    const body = JSON.parse(validCampaign);
    body.brand_new_param = 'oops';

    await expect(
      call(`${GRAPH_API_BASE}/${ACT}/campaigns`, {
        method: 'POST',
        body: JSON.stringify(body),
      })
    ).rejects.toThrow(/brand_new_param/);
  });

  it('throws on a missing required field', async () => {
    await expect(
      call(`${GRAPH_API_BASE}/${ACT}/ads`, {
        method: 'POST',
        body: JSON.stringify({ name: 'ad missing adset_id' }),
      })
    ).rejects.toThrow(/Request contract violation on ads\.createAd/);
  });

  it('accepts a valid payload', async () => {
    const { body } = await call(`${GRAPH_API_BASE}/${ACT}/campaigns`, {
      method: 'POST',
      body: validCampaign,
    });
    expect(s.idResponse.parse(body).id).toMatch(/^camp-/);
  });
});

describe('responses satisfy the declared response schemas', () => {
  // If the fake could answer with a shape the contract forbids, Tier 1 and
  // Tier 2 would disagree and the shared-schema design would be a lie.
  it('create endpoints return a parseable { id }', async () => {
    const cases: Array<[string, string, string]> = [
      [`${GRAPH_API_BASE}/${ACT}/campaigns`, validCampaign, 'camp-'],
      [
        `${GRAPH_API_BASE}/${ACT}/adsets`,
        JSON.stringify({
          name: 'set',
          campaign_id: 'c1',
          status: 'PAUSED',
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'LEAD_GENERATION',
          targeting: { geo_locations: { countries: ['IE'] } },
        }),
        'adset-',
      ],
      [
        `${GRAPH_API_BASE}/${ACT}/ads`,
        JSON.stringify({
          name: 'ad',
          adset_id: 'as1',
          creative: { creative_id: 'cr1' },
          status: 'PAUSED',
        }),
        'ad-',
      ],
    ];

    for (const [url, body, prefix] of cases) {
      const res = await call(url, { method: 'POST', body });
      expect(s.idResponse.parse(res.body).id).toMatch(new RegExp(`^${prefix}`));
    }
  });

  it('the page lookup returns a linked Instagram account', async () => {
    // LOAD-BEARING: seedMetaAds reads this, and a null here permanently
    // disables the Instagram destination — create-campaign.connected.spec.ts
    // could not pass at all.
    const { body } = await call(
      `${GRAPH_API_BASE}/${PAGE}?fields=name,instagram_business_account{id,username,name}`
    );

    const parsed = s.pageLookupResponse.parse(body);
    expect(parsed.instagram_business_account?.id).toBeTruthy();
    expect(parsed.name).toBeTruthy();
  });

  it('an ad reports effective_status ACTIVE on the first poll', async () => {
    // waitForAdActive polls every 30s for up to 300s. Returning ACTIVE
    // immediately is minutes back on every ad spec.
    const { body } = await call(
      `${GRAPH_API_BASE}/ad-1?fields=id,name,status,effective_status`
    );
    expect(s.getAdResponse.parse(body).effective_status).toBe('ACTIVE');
  });

  it('image upload returns the images.<key>.hash shape', async () => {
    const { body } = await call(`${GRAPH_API_BASE}/${ACT}/adimages`, {
      method: 'POST',
      body: 'bytes=abc',
    });
    const parsed = s.uploadImageResponse.parse(body);

    // The OUTER key is arbitrary — Meta keys it by filename, and the uploader
    // reads `Object.keys(data.images)[0]`. Asserting a specific key would be
    // testing the fake's choice of filename, not the contract.
    const first = Object.values(parsed.images)[0];
    expect(first?.hash).toBeTruthy();
  });

  it('Messenger and WhatsApp sends return parseable envelopes', async () => {
    const messenger = await call(`${GRAPH_API_BASE}/me/messages`, {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: 'user-1' },
        message: { text: 'hello' },
      }),
    });
    expect(s.sendMessageResponse.parse(messenger.body).message_id).toBeTruthy();

    const whatsapp = await call(`${GRAPH_API_BASE}/5551234/messages`, {
      method: 'POST',
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: '353850000000',
        type: 'text',
        text: { body: 'hi' },
      }),
    });
    const parsed = s.whatsappSendResponse.parse(whatsapp.body);
    expect(parsed.messages?.[0]?.id).toMatch(/^wamid\./);
  });

  it('page publish returns { id, post_id }', async () => {
    const { body } = await call(`${GRAPH_API_BASE}/${PAGE}/photos`, {
      method: 'POST',
      body: new URLSearchParams({
        url: 'https://cdn.example.com/x.jpg',
        access_token: 'tok',
        message: 'caption',
      }).toString(),
    });
    expect(s.publishPostResponse.parse(body).post_id).toBeTruthy();
  });

  it('IG container status reports FINISHED so publishing proceeds', async () => {
    const { body } = await call(
      'https://graph.instagram.com/v22.0/container-1?fields=status_code,status,error_message'
    );
    expect(s.instagramContainerStatusResponse.parse(body).status_code).toBe(
      'FINISHED'
    );
  });
});

describe('statelessness (no shared memory between processes)', () => {
  it('derives ids a later request has to recognise', async () => {
    // The API and worker are separate processes with no shared state, so
    // anything a SUBSEQUENT request must match — here the image hash a creative
    // refers to — has to be derived, not remembered.
    const a = await call(`${GRAPH_API_BASE}/${ACT}/adimages`, {
      method: 'POST',
      body: 'multipart-bytes',
    });
    const b = await call(`${GRAPH_API_BASE}/${ACT}/adimages`, {
      method: 'POST',
      body: 'multipart-bytes',
    });
    const hashOf = (r: typeof a) =>
      (r.body as { images: Record<string, { hash: string }> }).images[
        'image.jpg'
      ].hash;
    expect(hashOf(a)).toBe(hashOf(b));
  });

  it('mints a FRESH id per create, as Meta does', async () => {
    // REGRESSION: creates used to hash the request body, so two identical
    // payloads collapsed onto one id. `meta_campaign_config.meta_campaign_id`
    // is UNIQUE, so the second org seeding the fixture campaign got a 422:
    // "duplicate key value violates unique constraint".
    const a = await call(`${GRAPH_API_BASE}/${ACT}/campaigns`, {
      method: 'POST',
      body: validCampaign,
    });
    const b = await call(`${GRAPH_API_BASE}/${ACT}/campaigns`, {
      method: 'POST',
      body: validCampaign,
    });
    expect((a.body as { id: string }).id).not.toBe(
      (b.body as { id: string }).id
    );
    // Still prefixed — `marketing` scope routes bare /{id} ops on that prefix.
    expect((a.body as { id: string }).id).toMatch(/^camp-/);
  });
});

describe('magic ids — error paths that were previously untestable', () => {
  it('provokes a code-17 rate limit', async () => {
    // Build the id from the exported constant so renaming a sentinel breaks
    // this test rather than silently disabling the behaviour it guards.
    const rateLimitToken = Object.keys(MAGIC_IDS).find(
      (k) => MAGIC_IDS[k as keyof typeof MAGIC_IDS] === 'rate-limit'
    );
    const { status, body } = await call(
      `${GRAPH_API_BASE}/act_${rateLimitToken}/campaigns`,
      { method: 'POST', body: validCampaign }
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 17 } });
  });

  it('provokes a revoked token (drives the reconnect flow)', async () => {
    const { status, body } = await call(
      `${GRAPH_API_BASE}/act_E2EAUTHREVOKED/campaigns`,
      { method: 'POST', body: validCampaign }
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 190, error_subcode: 458 } });
  });

  it('provokes a generic permission failure (code 10 → FORBIDDEN → 403, ENG-852)', async () => {
    const { status, body } = await call(
      `${GRAPH_API_BASE}/act_E2EPERMISSION/campaigns`,
      { method: 'POST', body: validCampaign }
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 10, type: 'OAuthException' } });
  });

  it('provokes an appsecret_proof mismatch', async () => {
    const { body } = await call(
      `${GRAPH_API_BASE}/act_E2EAPPSECRET/campaigns`,
      {
        method: 'POST',
        body: validCampaign,
      }
    );
    expect(body).toMatchObject({
      error: { message: expect.stringContaining('appsecret_proof') },
    });
  });

  it('reports a disapproved ad instead of ACTIVE', async () => {
    const { body } = await call(
      `${GRAPH_API_BASE}/ad-E2EDISAPPROVED?fields=id,effective_status`
    );
    expect(s.getAdResponse.parse(body).effective_status).toBe('DISAPPROVED');
  });

  it('detects a magic id carried in the BODY, not just the path', async () => {
    // Messenger recipients live in the body, not the URL.
    const { status, body } = await call(`${GRAPH_API_BASE}/me/messages`, {
      method: 'POST',
      body: JSON.stringify({
        recipient: { id: 'E2ERATELIMIT-user' },
        message: { text: 'hi' },
      }),
    });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: 17 } });
  });

  it('never resolves for the timeout sentinel', async () => {
    // The seam races interceptors against the abort signal, so an unresolved
    // promise becomes a real FetchTimeoutError for the caller.
    vi.useFakeTimers();
    const pending = fake(`${GRAPH_API_BASE}/act_E2ETIMEOUT/campaigns`, {
      method: 'POST',
      body: validCampaign,
    });

    let settled = false;
    void pending.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(settled).toBe(false);
    vi.useRealTimers();
  });
});

describe('the object graph — what was created is what is listed', () => {
  // THE BUG THIS PINS: `GET /act_x/campaigns` and `GET /{campaignId}/ads` were
  // undeclared, so under `marketing` scope they passed through to REAL Meta
  // while the creates above were faked. `list-campaigns.service.ts` makes
  // Meta's list the SPINE (local config only enriches), so a campaign the fake
  // had just minted could never appear — every connected-ads spec that creates
  // a campaign and then looks for it failed, reading as "the API didn't
  // persist it".
  const ACCOUNT = 'act_objectgraph';

  async function createCampaign(name: string): Promise<string> {
    const { body } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/campaigns`, {
      method: 'POST',
      body: JSON.stringify({
        ...JSON.parse(validCampaign),
        name,
        daily_budget: 500,
      }),
    });
    return (body as { id: string }).id;
  }

  async function listCampaigns(): Promise<Record<string, unknown>[]> {
    const { body } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/campaigns?fields=id,name,status,objective&limit=100`
    );
    return s.listResponse.parse(body).data;
  }

  it('lists a created campaign under the name we sent', async () => {
    const name = `E2E Campaign ${ACCOUNT}-1`;
    const id = await createCampaign(name);

    const listed = (await listCampaigns()).find((c) => c.id === id);
    expect(listed?.name).toBe(name);
    // Budgets come back as Graph strings — the UI renders them straight.
    expect(listed?.daily_budget).toBe('500');
  });

  it('reads the same name back through GET /{id}', async () => {
    const name = `E2E Campaign ${ACCOUNT}-2`;
    const id = await createCampaign(name);

    const { body } = await call(
      `${GRAPH_API_BASE}/${id}?fields=id,name,status,effective_status,objective`
    );
    expect(s.getCampaignResponse.parse(body).name).toBe(name);
  });

  it('lists an ad under its campaign, through the ad set', async () => {
    const campaignId = await createCampaign(`E2E Campaign ${ACCOUNT}-3`);

    const { body: adSet } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/adsets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'set',
        campaign_id: campaignId,
        status: 'PAUSED',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        targeting: { geo_locations: { countries: ['IE'] } },
      }),
    });

    const { body: ad } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/ads`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Ad',
        adset_id: (adSet as { id: string }).id,
        creative: { creative_id: 'creative-x' },
        status: 'PAUSED',
      }),
    });

    const { body: listed } = await call(
      `${GRAPH_API_BASE}/${campaignId}/ads?fields=id,name,status,adset_id&limit=100`
    );
    const ads = s.listResponse.parse(listed).data;
    expect(ads.map((a) => a.id)).toContain((ad as { id: string }).id);
  });

  it('an update lands on the stored node, so the edit reads back', async () => {
    const id = await createCampaign(`E2E Campaign ${ACCOUNT}-4`);

    await call(`${GRAPH_API_BASE}/${id}`, {
      method: 'POST',
      body: JSON.stringify({ name: 'Renamed', status: 'ACTIVE' }),
    });

    const listed = (await listCampaigns()).find((c) => c.id === id);
    expect(listed?.name).toBe('Renamed');
    expect(listed?.status).toBe('ACTIVE');
  });

  it('a delete removes it from the list', async () => {
    const id = await createCampaign(`E2E Campaign ${ACCOUNT}-5`);
    await call(`${GRAPH_API_BASE}/${id}`, { method: 'DELETE' });

    expect((await listCampaigns()).map((c) => c.id)).not.toContain(id);
  });

  it('scopes the list to its own ad account', async () => {
    const id = await createCampaign(`E2E Campaign ${ACCOUNT}-6`);
    const { body } = await call(
      `${GRAPH_API_BASE}/act_someoneelse/campaigns?fields=id,name`
    );
    expect(s.listResponse.parse(body).data.map((c) => c.id)).not.toContain(id);
  });

  it('copies a campaign under the renamed title', async () => {
    const id = await createCampaign(`E2E Campaign ${ACCOUNT}-7`);

    const { body } = await call(`${GRAPH_API_BASE}/${id}/copies`, {
      method: 'POST',
      body: JSON.stringify({
        deep_copy: true,
        status_option: 'PAUSED',
        rename_options: JSON.stringify({
          rename_strategy: 'ONLY_TOP_LEVEL_RENAME',
          rename_suffix: ' (copy)',
        }),
      }),
    });

    const copyId = s.copyCampaignResponse.parse(body).copied_campaign_id;
    expect(copyId).toBeTruthy();
    expect(copyId).not.toBe(id);

    const copy = (await listCampaigns()).find((c) => c.id === copyId);
    expect(copy?.name).toBe(`E2E Campaign ${ACCOUNT}-7 (copy)`);
  });
});

describe('an ad edit follows through to the list read', () => {
  // `updateAd` re-points the ad at a NEW creative — that indirection IS the
  // edit, so a store that only patched name/status would serve the pre-edit
  // creative and "verifies changes persist" could never pass.
  const ACCOUNT = 'act_adedit';

  it('serves the new creative after the ad is re-pointed', async () => {
    const { body: campaign } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/campaigns`,
      { method: 'POST', body: validCampaign }
    );
    const campaignId = (campaign as { id: string }).id;

    const { body: adSet } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/adsets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'set',
        campaign_id: campaignId,
        status: 'PAUSED',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        targeting: { geo_locations: { countries: ['IE'] } },
      }),
    });

    const creativeOf = async (name: string) => {
      const { body } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/adcreatives`, {
        method: 'POST',
        body: JSON.stringify({
          name,
          object_story_spec: {
            page_id: PAGE,
            link_data: { link: 'https://example.com', message: name },
          },
        }),
      });
      return (body as { id: string }).id;
    };

    const { body: ad } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/ads`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'E2E Ad',
        adset_id: (adSet as { id: string }).id,
        creative: { creative_id: await creativeOf('before') },
        status: 'PAUSED',
      }),
    });
    const adId = (ad as { id: string }).id;

    const edited = await creativeOf('after');
    await call(`${GRAPH_API_BASE}/${adId}`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Edited',
        creative: { creative_id: edited },
      }),
    });

    const { body: listed } = await call(
      `${GRAPH_API_BASE}/${campaignId}/ads?fields=id,name,creative{id,name}`
    );
    const found = s.listResponse
      .parse(listed)
      .data.find((a) => a.id === adId) as
      | { name: string; creative: { id: string; name: string } }
      | undefined;

    expect(found?.name).toBe('Edited');
    expect(found?.creative.id).toBe(edited);
    expect(found?.creative.name).toBe('after');
  });
});

describe('the pre-publish account health gate', () => {
  // The wizard runs `getAdAccountHealth` before it will publish ANYTHING, and
  // refuses with "Your ad account is unknown" when `account_status` is absent.
  // The fake used to answer this node with `funding_source_details` alone, so
  // every ad-launch spec died at the gate — before a single Graph write, which
  // is why it looked like a UI failure rather than a contract gap.
  it('answers the full health field set, not just the funding source', async () => {
    const { body } = await call(
      `${GRAPH_API_BASE}/${ACT}?fields=account_status,disable_reason,currency,spend_cap,amount_spent,funding_source_details{type}`
    );
    const health = s.fundingSourceResponse.parse(body);

    expect(health.account_status).toBe(1); // Meta's ACTIVE
    expect(health.disable_reason).toBe(0);
    expect(health.currency).toBeTruthy();
    expect(health.funding_source_details?.type).toBe(1);
  });

  it('answers the same on a bare node read, which shares the branch', async () => {
    const { body } = await call(
      `${GRAPH_API_BASE}/${PAGE}?fields=funding_source_details{type}`
    );
    expect(s.fundingSourceResponse.parse(body).account_status).toBe(1);
  });
});

describe('GET /{id} field discrimination', () => {
  // `GET /{id}` is overloaded across campaign / ad / ad set / creative / page /
  // permalink, and only `fields` tells them apart. Matching on a substring is
  // therefore fragile in one specific way: nested selections.
  it('answers an AD read with effective_status, not the permalink shape', async () => {
    // THE BUG. `getAd` asks for
    //   …,effective_status,…,creative{thumbnail_url,effective_object_story_id,…}
    // and the permalink branch matched that nested `effective_object_story_id`
    // FIRST, answering `{ id, creative: {…} }` with no status anywhere.
    // `verifyAdLaunchState` then reported `unverified` — ADR-005 refuses to
    // fabricate 'live' — so the ad never reached `active` and every launch spec
    // sat in `waitForAdActive` until it timed out.
    const { body } = await call(
      `${GRAPH_API_BASE}/ad-1?fields=id,name,status,effective_status,created_time,updated_time,creative{thumbnail_url,effective_object_story_id,object_story_spec}`
    );
    const ad = s.getAdResponse.parse(body);

    expect(ad.effective_status).toBe('ACTIVE');
    // …and still carries the creative the same read selected.
    expect(
      (ad as { creative?: { effective_object_story_id?: string } }).creative
        ?.effective_object_story_id
    ).toBe('ad-1_story');
  });

  it('still answers a permalink-only read with the permalink shape', async () => {
    const { body } = await call(
      `${GRAPH_API_BASE}/ad-2?fields=creative{effective_object_story_id}`
    );
    expect(
      (body as { creative: { effective_object_story_id: string } }).creative
        .effective_object_story_id
    ).toBe('ad-2_story');
  });

  it('serves a launched ad its real effective_status through the whole flow', async () => {
    // create → activate (POST /{id}) → read back, the exact sequence
    // `finalizeAd` runs before it decides the local status.
    const { body: created } = await call(`${GRAPH_API_BASE}/${ACT}/ads`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Launched Ad',
        adset_id: 'adset-x',
        creative: { creative_id: 'creative-x' },
        status: 'PAUSED',
      }),
    });
    const adId = (created as { id: string }).id;

    await call(`${GRAPH_API_BASE}/${adId}`, {
      method: 'POST',
      body: JSON.stringify({ status: 'ACTIVE' }),
    });

    const { body } = await call(
      `${GRAPH_API_BASE}/${adId}?fields=id,name,status,effective_status,created_time,updated_time,creative{thumbnail_url,effective_object_story_id,object_story_spec}`
    );
    const ad = s.getAdResponse.parse(body);

    expect(ad.name).toBe('Launched Ad');
    expect(ad.effective_status).toBe('ACTIVE');
  });
});

describe('video processing status', () => {
  it('reports ready, as an OBJECT — not the node status string', async () => {
    // `getVideoStatus` reads `data.status.video_status`. The node branch
    // answers `status` as a STRING, so this read fell through to it and
    // `video_status` came back undefined → 'processing' forever →
    // waitForVideoReady polls 60 × 3s inside finalizeAd and then fails with
    // "video not ready", naming nothing that points at the fake.
    const { body } = await call(
      `${GRAPH_API_BASE}/vid-abc123?fields=status,picture,thumbnails`
    );
    const video = body as {
      status: { video_status: string };
      thumbnails: { data: Array<{ uri: string }> };
    };

    expect(video.status.video_status).toBe('ready');
    expect(video.thumbnails.data[0]?.uri).toBeTruthy();
  });

  it('does not shadow an ad status read', async () => {
    // The two reads both mention `status`; only the video one asks for
    // `thumbnails`.
    const { body } = await call(
      `${GRAPH_API_BASE}/ad-9?fields=id,name,status,effective_status`
    );
    expect(typeof s.getAdResponse.parse(body).effective_status).toBe('string');
  });
});

describe('reads that select no status field', () => {
  // Enumerating every `?fields=` in meta-ads.service turned up reads the
  // branch chain answered with a bare `{ id }` — the same class of lie as the
  // old constant name: the caller gets undefined for everything it selected
  // and reports it as missing data rather than a contract gap.
  const ACCOUNT = 'act_noStatus';

  it('answers getCreative with its story spec even though it selects status', async () => {
    // `id,name,status,object_story_spec` carries `status`, so it lands in the
    // node branch — which has to serve object_story_spec too, or the creative
    // verification in finalizeAd sees a creative with no spec.
    const { body: created } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Spec Creative',
          object_story_spec: {
            page_id: PAGE,
            link_data: { link: 'https://example.com' },
          },
        }),
      }
    );
    const creativeId = (created as { id: string }).id;

    const { body } = await call(
      `${GRAPH_API_BASE}/${creativeId}?fields=id,name,status,object_story_spec`
    );
    const creative = s.getCreativeResponse.parse(body);
    expect(creative.name).toBe('Spec Creative');
    expect(creative.object_story_spec).toBeDefined();
  });

  it('answers an ad set read that selects no status at all', async () => {
    const { body: campaign } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/campaigns`,
      { method: 'POST', body: validCampaign }
    );
    const { body: created } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/adsets`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Targeted Set',
          campaign_id: (campaign as { id: string }).id,
          status: 'PAUSED',
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'LEAD_GENERATION',
          targeting: { geo_locations: { countries: ['IE'] } },
        }),
      }
    );
    const adSetId = (created as { id: string }).id;

    // getAdSet — no `status`, no `effective_status`.
    const { body } = await call(
      `${GRAPH_API_BASE}/${adSetId}?fields=id,name,destination_type,optimization_goal,billing_event,targeting,promoted_object`
    );
    expect((body as { id: string; name: string }).name).toBe('Targeted Set');
  });

  it('resolves the nested campaign{id,name} an ad read selects', async () => {
    const { body: campaign } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/campaigns`,
      {
        method: 'POST',
        body: JSON.stringify({
          ...JSON.parse(validCampaign),
          name: 'Parent Campaign',
        }),
      }
    );
    const { body: adSet } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/adsets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'set',
        campaign_id: (campaign as { id: string }).id,
        status: 'PAUSED',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        targeting: { geo_locations: { countries: ['IE'] } },
      }),
    });
    const { body: ad } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/ads`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Nested Ad',
        adset_id: (adSet as { id: string }).id,
        creative: { creative_id: 'creative-n' },
        status: 'PAUSED',
      }),
    });

    const { body } = await call(
      `${GRAPH_API_BASE}/${(ad as { id: string }).id}?fields=id,name,status,effective_status,created_time,updated_time,campaign{id,name}`
    );
    const nested = body as { campaign: { id: string; name: string } };
    expect(nested.campaign.id).toBe((campaign as { id: string }).id);
    expect(nested.campaign.name).toBe('Parent Campaign');
  });
});

describe('creative video_id survives to the ad list', () => {
  it('carries object_story_spec.video_data.video_id through to /{campaignId}/ads', async () => {
    // `list-ads` reconciles a Graph ad against a still-finalizing local row by
    // `creative.object_story_spec.video_data.video_id`. A creative stored
    // without its spec makes that match impossible, so an ad that HAS launched
    // never gets adopted and stays 'launching'.
    const ACCOUNT = 'act_videoid';
    const { body: campaign } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/campaigns`,
      { method: 'POST', body: validCampaign }
    );
    const campaignId = (campaign as { id: string }).id;

    const { body: adSet } = await call(`${GRAPH_API_BASE}/${ACCOUNT}/adsets`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'set',
        campaign_id: campaignId,
        status: 'PAUSED',
        billing_event: 'IMPRESSIONS',
        optimization_goal: 'LEAD_GENERATION',
        targeting: { geo_locations: { countries: ['IE'] } },
      }),
    });

    const { body: creative } = await call(
      `${GRAPH_API_BASE}/${ACCOUNT}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Video Creative',
          object_story_spec: {
            page_id: PAGE,
            video_data: {
              video_id: 'vid-known-123',
              image_url: 'https://x/y.jpg',
            },
          },
        }),
      }
    );

    await call(`${GRAPH_API_BASE}/${ACCOUNT}/ads`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Video Ad',
        adset_id: (adSet as { id: string }).id,
        creative: { creative_id: (creative as { id: string }).id },
        status: 'PAUSED',
      }),
    });

    const { body } = await call(
      `${GRAPH_API_BASE}/${campaignId}/ads?fields=id,name,creative{object_story_spec}`
    );
    const [listed] = s.listResponse.parse(body).data as Array<{
      creative?: { object_story_spec?: { video_data?: { video_id?: string } } };
    }>;

    expect(listed?.creative?.object_story_spec?.video_data?.video_id).toBe(
      'vid-known-123'
    );
  });
});

describe('image creatives carry a description', () => {
  // `buildAdCreative`'s image branch sends the ad's `description` as
  // `link_data.description` — a real Meta field. The fake's `.strict()`
  // link_data omitted it, so publishing ANY image ad that had a description
  // threw "Unrecognized key: description" before reaching a responder. A
  // contract fake calling a correct payload wrong is worse than a gap: the
  // connected suite could never have published one.
  it('accepts link_data.description', async () => {
    const { status, body } = await call(
      `${GRAPH_API_BASE}/${ACT}/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'Autumn Haircut Promo - Creative',
          object_story_spec: {
            page_id: PAGE,
            link_data: {
              link: 'https://example.com',
              message: 'Chairs free this week.',
              name: 'Autumn cuts, booking now',
              description: 'Book online',
              image_hash: 'imghash-1b7c5e10d24a',
            },
          },
        }),
      }
    );

    expect(status).toBe(200);
    expect(body).toHaveProperty('id');
  });

  it('still rejects a key Meta does not have', async () => {
    // The point is a CORRECT contract, not a loose one.
    await expect(
      call(`${GRAPH_API_BASE}/${ACT}/adcreatives`, {
        method: 'POST',
        body: JSON.stringify({
          name: 'Bogus - Creative',
          object_story_spec: {
            page_id: PAGE,
            link_data: { link: 'https://example.com', subtitle: 'nope' },
          },
        }),
      })
    ).rejects.toThrow(/Unrecognized key/);
  });
});
