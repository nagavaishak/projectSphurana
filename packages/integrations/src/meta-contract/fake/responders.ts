import { createHash, randomUUID } from 'node:crypto';
import type { ParsedGraphUrl } from '../match.js';
import {
  type FakeObject,
  type FakeObjectKind,
  campaignIdOfAd,
  deleteFakeObject,
  findFakeObjects,
  getFakeObject,
  patchFakeObject,
  recordFakeObject,
} from './store.js';

/**
 * STATELESS responses for each endpoint.
 *
 * WHY STATELESS
 * -------------
 * The API and the worker are separate processes. Anything the fake remembers in
 * one is invisible to the other, so an in-memory store would diverge the moment
 * a chatbot job ran in the worker while the browser talked to the API. So the
 * fake never remembers: an id is either DERIVED from the request (both
 * processes compute the same answer without sharing state) or MINTED fresh.
 *
 * This also removes any test-ordering coupling — there is nothing to reset
 * between specs.
 *
 * DERIVED vs MINTED
 * -----------------
 * Cross-process agreement is only needed where a LATER request has to recognise
 * an id it did not receive in a response — the chunked-upload session (whose id
 * encodes the byte total the transfer phase reads back) and the image hash a
 * creative refers to. Those stay derived.
 *
 * Everything that CREATES a Meta object mints a fresh id, because that is what
 * Meta does: two identical `POST /act_x/campaigns` calls yield two campaigns
 * with two ids. Deriving the id from the body made them collapse into one, and
 * `meta_campaign_config.meta_campaign_id` is UNIQUE — so the second org (or the
 * second run after a cleanup) seeding the same fixture payload got
 * `duplicate key value violates unique constraint` as a 422 out of
 * `POST /meta-campaigns`. Nothing re-derives a create response: the id is
 * returned once and persisted, and reads (`GET /{id}`) echo the path back.
 *
 * The specs don't actually read much from Meta: the ads specs assert against
 * OUR api (`seed.listAds`), and the social-post specs stop at
 * `status === 'scheduled'`. What Meta has to supply is ids, and an
 * `effective_status` that reaches `ACTIVE` — so `waitForAdActive` returns on
 * its FIRST poll instead of burning up to 300s.
 */

/** Stable pseudo-id from the request, so repeat calls agree across processes. */
export function derivedId(prefix: string, seed: string): string {
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

/**
 * A fresh id for a newly created object — unique per call, like Meta's.
 *
 * The prefix is load-bearing: `marketing` scope decides whether a bare
 * `/{id}` operation is ours by matching `FAKE_ID_PREFIXES` (see `index.ts`).
 */
export function mintedId(prefix: string): string {
  return `${prefix}-${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export interface ResponderContext {
  parsed: ParsedGraphUrl;
  body: string | null;
  /** True when a magic id asked for a disapproved ad. */
  disapproved: boolean;
}

/** `fields` query param split into a set, for discriminating `GET /{id}`. */
function requestedFields(parsed: ParsedGraphUrl): string {
  return parsed.query.get('fields') ?? '';
}

function nodeIdFrom(parsed: ParsedGraphUrl): string {
  return parsed.path.split('/').filter(Boolean)[0] ?? 'unknown';
}

/** JSON request body, or `{}` for anything that isn't JSON. */
function jsonBody(body: string | null): Record<string, unknown> {
  if (!body) return {};
  try {
    const parsed: unknown = JSON.parse(body);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Graph timestamps. Only ordering-insensitive assertions read these. */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Record a newly created Marketing-API object and return its id.
 *
 * The stored `fields` are what `GET` on this node — bare, or through a list
 * edge — will answer with, so the NAME our code sent is the name it reads
 * back. That round-trip is the whole point: `list-campaigns.service.ts` takes
 * the campaign name from Meta (the local config row has no name column), so a
 * fake that invented one made every "my campaign is in the list" assertion
 * unsatisfiable. See `store.ts`.
 */
async function createNode(
  kind: FakeObjectKind,
  prefix: string,
  ctx: ResponderContext,
  extra: (
    body: Record<string, unknown>
  ) => Record<string, unknown> | Promise<Record<string, unknown>> = () => ({})
): Promise<{ id: string }> {
  const body = jsonBody(ctx.body);
  const id = mintedId(prefix);
  const status = str(body.status) ?? 'PAUSED';
  const now = nowIso();

  const extras = await extra(body);

  await recordFakeObject({
    id,
    kind,
    ownerId: nodeIdFrom(ctx.parsed),
    parentId: str(body.campaign_id) ?? str(body.adset_id),
    fields: {
      id,
      name: str(body.name) ?? `E2E ${kind}`,
      status,
      // The fake answers ACTIVE so `waitForAdActive` returns on its FIRST poll
      // rather than burning up to 300s — see the module header.
      effective_status: 'ACTIVE',
      created_time: now,
      updated_time: now,
      ...extras,
    },
  });

  return { id };
}

/** Stored nodes of one kind, as Graph list entries. */
async function nodesOf(
  kind: FakeObjectKind,
  predicate: (object: FakeObject) => boolean | Promise<boolean>
): Promise<Record<string, unknown>[]> {
  const candidates = await findFakeObjects((o) => o.kind === kind);
  const kept = await Promise.all(candidates.map((o) => predicate(o)));
  return candidates.filter((_, i) => kept[i]).map((o) => o.fields);
}

/**
 * The nested `creative{…}` an ad carries in `listCampaignAdsWithCreative`.
 * Served from the store when we minted it, so an edited creative's copy reads
 * back — `edit-ad.connected.spec.ts` asserts exactly that.
 */
async function creativeNode(
  creativeId: string
): Promise<Record<string, unknown>> {
  const stored = await getFakeObject(creativeId);
  return { ...(stored?.fields ?? {}), id: creativeId };
}

/**
 * An ad account that PASSES the pre-publish health gate.
 *
 * `getAdAccountHealth` reads `account_status`, `disable_reason`, `currency`,
 * `spend_cap`, `amount_spent` and `funding_source_details{type}` off the SAME
 * `GET /act_x` the funding-source check uses. Answering only the funding field
 * left `account_status` undefined, which the wizard renders as "Your ad account
 * is unknown" and refuses to publish behind — so every ad-launch spec died at
 * the gate, before a single Graph write. `1` is Meta's ACTIVE; `disable_reason`
 * 0 is "not disabled"; a `spend_cap` of 0 means no cap.
 */
function healthyAdAccount(): Record<string, unknown> {
  return {
    account_status: 1,
    disable_reason: 0,
    currency: 'EUR',
    spend_cap: '0',
    amount_spent: '0',
    funding_source_details: { type: 1 },
  };
}

/** `rename_options` arrives as a JSON *string* nested in the copy body. */
function renameSuffix(body: string | null): string {
  const raw = str(jsonBody(body).rename_options);
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as { rename_suffix?: string };
    return parsed.rename_suffix ?? '';
  } catch {
    return '';
  }
}

/**
 * `GET /{id}` is heavily overloaded — campaign, ad, ad set, creative, page
 * lookup, post-exists check. The PATH is identical for all of them; only the
 * requested `fields` distinguish them. So we discriminate on `fields`, in
 * specificity order.
 */
async function respondNodeGet(ctx: ResponderContext): Promise<unknown> {
  const fields = requestedFields(ctx.parsed);
  const id = nodeIdFrom(ctx.parsed);

  // The seedMetaAds page lookup. LOAD-BEARING: a null
  // instagram_business_account permanently disables the Instagram destination,
  // and create-campaign.connected.spec.ts cannot pass without it.
  if (fields.includes('instagram_business_account')) {
    return {
      id,
      name: 'E2E Test Page',
      instagram_business_account: {
        id: derivedId('ig', id),
        username: 'e2e_test_ig',
        name: 'E2E Test IG',
      },
    };
  }

  if (fields.includes('funding_source_details')) {
    return { id, ...healthyAdAccount() };
  }

  if (fields.includes('followers_count')) {
    return { id, followers_count: 1234 };
  }

  // Video processing status — `GET /{videoId}?fields=status,picture,thumbnails`.
  //
  // MUST precede the status branch below: this read also asks for `status`, but
  // as an OBJECT (`status.video_status`), not the node's status string.
  // Answering it with the node shape leaves `video_status` undefined, so
  // `getVideoStatus` reports 'processing' forever and `waitForVideoReady`
  // polls 60 × 3s before giving up — a silent 180s stall inside finalizeAd,
  // ending in "video not ready" rather than anything naming the real cause.
  // `thumbnails` is the discriminator: no other read requests it.
  if (fields.includes('thumbnails')) {
    return {
      id,
      status: { video_status: 'ready' },
      picture: 'https://scontent.xx.fbcdn.net/e2e-fake-video-thumb.jpg',
      thumbnails: {
        data: [
          { uri: 'https://scontent.xx.fbcdn.net/e2e-fake-video-thumb.jpg' },
        ],
      },
    };
  }

  // Ad / campaign / ad set status read. `effective_status` is what
  // waitForAdActive polls on — ACTIVE unless a magic id asked otherwise.
  //
  // ORDER IS LOAD-BEARING, and this branch has to win over the creative ones
  // below. `getAd` asks for
  //   …,effective_status,…,creative{thumbnail_url,effective_object_story_id,object_story_spec}
  // so a naive `fields.includes('effective_object_story_id')` matches an AD
  // read on a string nested inside `creative{…}`, and answers it with the
  // PERMALINK shape — no effective_status at all. `verifyAdLaunchState` then
  // cannot verify (ADR-005 refuses to fabricate 'live'), the ad never reaches
  // `active`, and `waitForAdActive` burns its full 300s. The nested-field
  // request is a superset, so match the more specific thing first.
  if (fields.includes('effective_status') || fields.includes('status')) {
    // Answer with the node we actually minted when we have it. The constant
    // that used to live here reported every campaign as "E2E Entity", which
    // silently renamed anything read back through Meta.
    const stored = await getFakeObject(id);
    return {
      id,
      name: 'E2E Entity',
      status: 'ACTIVE',
      objective: 'OUTCOME_LEADS',
      ...(stored?.fields ?? {}),
      effective_status: ctx.disapproved
        ? 'DISAPPROVED'
        : (stored?.fields.effective_status ?? 'ACTIVE'),
      // The nested selections the SAME read asks for. Graph returns these
      // inline; a caller that selected `creative{…}` or `campaign{…}` reads
      // them straight off this response.
      ...(fields.includes('creative') && {
        creative: {
          ...(stored?.fields.creative as Record<string, unknown> | undefined),
          effective_object_story_id: `${id}_story`,
          thumbnail_url: 'https://scontent.xx.fbcdn.net/e2e-fake-thumb.jpg',
          object_story_spec: {},
        },
      }),
      ...(fields.includes('campaign{') && {
        campaign: await campaignNodeOf(stored),
      }),
      ...(fields.includes('adset{') && {
        adset: { id: stored?.parentId ?? 'adset-unknown' },
      }),
      // `getCreative` selects `id,name,status,object_story_spec` — it carries
      // `status`, so it lands HERE rather than in the creative branch below.
      ...(fields.includes('object_story_spec') && { object_story_spec: {} }),
    };
  }

  // Permalink-only read: `creative{effective_object_story_id}` with no status
  // field alongside it.
  if (fields.includes('effective_object_story_id')) {
    return { id, creative: { effective_object_story_id: `${id}_story` } };
  }

  // Creative read (`getCreative`) — no status requested, but the story spec is.
  if (fields.includes('object_story_spec')) {
    const stored = await getFakeObject(id);
    return {
      id,
      name: 'E2E Creative',
      status: 'ACTIVE',
      ...(stored?.fields ?? {}),
      object_story_spec: {},
    };
  }

  // Anything else. When we minted this node, answer with it — reads like
  // `getAdSet` select `id,name,destination_type,optimization_goal,…` with no
  // status field at all, and returning a bare `{ id }` for a node we HAVE is
  // the same class of lie as the old constant name: the caller gets undefined
  // for every field it asked for and reports it as missing data.
  const stored = await getFakeObject(id);
  if (stored) return { ...stored.fields, id };

  // Genuinely unknown node — the social-post existence check lands here.
  return { id };
}

/** The nested `campaign{id,name}` an ad read selects, walked ad → adset → campaign. */
async function campaignNodeOf(
  ad: FakeObject | undefined
): Promise<Record<string, unknown>> {
  const campaignId = ad ? await campaignIdOfAd(ad) : undefined;
  const campaign = campaignId ? await getFakeObject(campaignId) : undefined;
  return {
    id: campaignId ?? 'camp-unknown',
    name: str(campaign?.fields.name) ?? 'E2E Campaign',
  };
}

/**
 * Read the `upload_phase` from a video-upload body.
 *
 * The three phases arrive in TWO different encodings, which is what an earlier
 * version got wrong:
 *   - `start` and `finish` are JSON  → `{"upload_phase":"start", …}`
 *   - `transfer` is MULTIPART        → `name="upload_phase"\r\n\r\ntransfer`
 *
 * The multipart form is a `Buffer`, so it only reaches us as a decoded prefix
 * (see `bodyAsString`). Matching a `key=value` pair — as the first version did
 * — never fires for any of them.
 */
function uploadPhase(
  body: string | null
): 'start' | 'transfer' | 'finish' | null {
  if (!body) return null;

  // JSON phases.
  try {
    const parsed = JSON.parse(body) as { upload_phase?: string };
    if (parsed.upload_phase === 'start') return 'start';
    if (parsed.upload_phase === 'finish') return 'finish';
    if (parsed.upload_phase === 'transfer') return 'transfer';
  } catch {
    // Not JSON — fall through to the multipart form.
  }

  // Multipart field: the value follows the header's blank line.
  const field = /name="upload_phase"\r?\n\r?\n([a-z]+)/.exec(body);
  const value = field?.[1];
  if (value === 'start' || value === 'transfer' || value === 'finish') {
    return value;
  }

  return null;
}

/** Read a multipart or JSON field value out of an upload body. */
function uploadField(body: string | null, field: string): string | null {
  if (!body) return null;

  const multipart = new RegExp(
    `name="${field}"\\r?\\n\\r?\\n([^\\r\\n]+)`
  ).exec(body);
  if (multipart?.[1]) return multipart[1];

  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const value = parsed[field];
    return value == null ? null : String(value);
  } catch {
    return null;
  }
}

/**
 * Chunked video upload: start → transfer → finish.
 *
 * STATELESS, BUT ACTUALLY DRIVES THE LOOP.
 *
 * The uploader advances with `while (startOffset < endOffset)`, taking the next
 * window from each transfer response. A fake that immediately converges the
 * offsets terminates the loop after ONE chunk — so a 24 MB video would upload
 * 4 MB and report success, which is exactly the silent-partial-upload bug this
 * responder is meant to make visible rather than reproduce.
 *
 * Tracking progress normally needs state, which we don't have (API and worker
 * are separate processes). So the total size is encoded INTO the session id at
 * `start` — `ups-<hash>-<total>` — and every `transfer` carries that id back in
 * its multipart body. The fake decodes the total from the id and computes the
 * next window arithmetically. No shared state, full protocol.
 *
 * Ids are seeded from the PATH, never the body: the multipart boundary embeds
 * `Date.now()`, so a body-seeded id would change between phases.
 */
function respondVideoUpload(ctx: ResponderContext): unknown {
  const seed = ctx.parsed.path;
  const phase = uploadPhase(ctx.body);

  if (phase === 'start') {
    const total = Number(uploadField(ctx.body, 'file_size') ?? CHUNK_BYTES);
    return {
      upload_session_id: `${derivedId('ups', seed)}-${total}`,
      video_id: derivedId('vid', seed),
      start_offset: '0',
      end_offset: String(Math.min(CHUNK_BYTES, total)),
    };
  }

  if (phase === 'transfer') {
    const sessionId = uploadField(ctx.body, 'upload_session_id') ?? '';
    const total = Number(sessionId.split('-').pop()) || CHUNK_BYTES;
    const sent = Number(uploadField(ctx.body, 'start_offset') ?? 0);

    const nextStart = Math.min(sent + CHUNK_BYTES, total);
    // Equal offsets end the loop — only once the whole file is consumed.
    const nextEnd = Math.min(nextStart + CHUNK_BYTES, total);

    return {
      start_offset: String(nextStart),
      end_offset: String(nextStart >= total ? nextStart : nextEnd),
    };
  }

  if (phase === 'finish') {
    return { success: true, id: derivedId('vid', seed) };
  }

  // Single (non-chunked) upload — a multipart body with no upload_phase field.
  return { id: derivedId('vid', seed) };
}

/** Mirrors MetaAdsService.CHUNK_SIZE (4 MB). */
const CHUNK_BYTES = 4 * 1024 * 1024;

type Responder = (ctx: ResponderContext) => unknown | Promise<unknown>;

/**
 * endpoint id → response builder.
 *
 * Every response here is asserted against its schema in `fake.test.ts`, so the
 * fake cannot answer with a shape the contract doesn't permit.
 */
export const RESPONDERS: Record<string, Responder> = {
  // Creates mint — see "DERIVED vs MINTED" above. A body-derived campaign id
  // collides on `meta_campaign_config.meta_campaign_id`'s UNIQUE constraint the
  // second time the same fixture payload is seeded.
  //
  // They also RECORD, so the list edges below can answer with them.
  'ads.createCampaign': (c) =>
    createNode('campaign', 'camp', c, (body) => ({
      objective: str(body.objective) ?? 'OUTCOME_LEADS',
      // Graph returns budgets as strings, and `list-campaigns` passes them
      // straight through to the UI.
      ...(body.daily_budget !== undefined && {
        daily_budget: String(body.daily_budget),
      }),
      ...(body.lifetime_budget !== undefined && {
        lifetime_budget: String(body.lifetime_budget),
      }),
    })),
  'ads.createAdSet': (c) => createNode('adset', 'adset', c),
  // Keep the `object_story_spec` we were sent: `listCampaignAdsWithCreative`
  // reads `creative.object_story_spec.video_data.video_id` to get `videoId`,
  // and `list-ads` reconciles a Graph ad against a still-finalizing local row
  // by exactly that id. Dropping the spec silently disables that match.
  'ads.createAdCreative': (c) =>
    createNode('creative', 'creative', c, (body) => ({
      ...(body.object_story_spec !== undefined && {
        object_story_spec: body.object_story_spec,
      }),
    })),
  'ads.createAd': (c) =>
    createNode('ad', 'ad', c, async (body) => {
      const creative = body.creative as { creative_id?: string } | undefined;
      return {
        ...(creative?.creative_id && {
          creative: await creativeNode(creative.creative_id),
        }),
        ...(str(body.adset_id) && { adset_id: str(body.adset_id) }),
      };
    }),
  'ads.createLeadGenForm': (c) => createNode('leadgenForm', 'form', c),

  // Reads over what was created. Undeclared until now, which meant they fell
  // through to REAL Meta under `marketing` scope while the writes above were
  // faked — see the header of `store.ts`.
  'ads.listCampaigns': async (c) => ({
    data: await nodesOf('campaign', (o) => o.ownerId === nodeIdFrom(c.parsed)),
  }),
  'ads.listAds': async (c) => ({
    data: await nodesOf('ad', (o) => o.ownerId === nodeIdFrom(c.parsed)),
  }),
  'ads.listCampaignAds': async (c) => {
    const campaignId = nodeIdFrom(c.parsed);
    return {
      data: await nodesOf(
        'ad',
        async (o) => (await campaignIdOfAd(o)) === campaignId
      ),
    };
  },
  'ads.listCampaignAdSets': async (c) => ({
    data: await nodesOf('adset', (o) => o.parentId === nodeIdFrom(c.parsed)),
  }),
  'ads.listLeadGenForms': async (c) => ({
    data: await nodesOf(
      'leadgenForm',
      (o) => o.ownerId === nodeIdFrom(c.parsed)
    ),
  }),
  // Nothing submits a lead form in the fake — inbound leads arrive by webhook,
  // which never touches Graph.
  'ads.listFormLeads': () => ({ data: [] }),

  // Deep-copy. Not routed through `createNode`: the path node is the SOURCE
  // campaign, not the ad account, so the copy has to inherit its owner (else it
  // would never appear in the account's campaign list).
  'ads.duplicateCampaign': async (c) => {
    const source = await getFakeObject(nodeIdFrom(c.parsed));
    const id = mintedId('camp');
    const now = nowIso();
    const { id: _sourceId, ...inherited } = source?.fields ?? {};

    await recordFakeObject({
      id,
      kind: 'campaign',
      ownerId: source?.ownerId ?? nodeIdFrom(c.parsed),
      fields: {
        ...inherited,
        id,
        name: `${str(source?.fields.name) ?? 'E2E campaign'}${renameSuffix(c.body)}`,
        status: 'PAUSED',
        created_time: now,
        updated_time: now,
      },
    });

    // Graph answers with `copied_campaign_id`; `copyCampaign` reads that first.
    return { copied_campaign_id: id, id, ad_object_ids: [] };
  },

  'ads.uploadVideo': respondVideoUpload,
  // Path-seeded, not body-seeded: the multipart boundary embeds `Date.now()`,
  // so a body-derived hash would change on every call.
  //
  // The outer key is arbitrary — Meta keys it by filename and our code reads
  // `Object.keys(data.images)[0]`, so only the nested `hash` matters.
  'ads.uploadImage': (c) => ({
    images: {
      'image.jpg': {
        hash: derivedId('imghash', c.parsed.path),
        url: 'https://scontent.xx.fbcdn.net/e2e-fake-image.jpg',
      },
    },
  }),

  // Serves BOTH `getFundingSource` and `getAdAccountHealth` — same `GET /act_x`
  // node, different `fields`. See `healthyAdAccount`.
  'ads.getFundingSource': (c) => ({
    id: nodeIdFrom(c.parsed),
    ...healthyAdAccount(),
  }),
  'ads.listCampaignInsights': () => ({ data: [] }),
  'ads.nodeInsights': () => ({ data: [] }),

  'pages.subscribeApp': () => ({ success: true }),
  'pages.publishFeed': () => {
    const id = mintedId('post');
    return { id, post_id: id };
  },
  'pages.publishPhoto': () => {
    const id = mintedId('photo');
    return { id, post_id: id };
  },
  'pages.publishVideo': () => {
    const id = mintedId('video');
    return { id, post_id: id };
  },
  'pages.listPosts': () => ({ data: [] }),

  'messaging.send': (c) => ({
    // The recipient is an identity, not a new object — same PSID every time.
    recipient_id: derivedId('recip', c.body ?? ''),
    message_id: mintedId('mid'),
  }),
  'messaging.listConversations': () => ({ data: [] }),

  'whatsapp.sendMessage': () => ({
    messaging_product: 'whatsapp',
    contacts: [{ input: 'e2e', wa_id: 'e2e' }],
    messages: [{ id: `wamid.${mintedId('wa')}` }],
  }),
  'whatsapp.listTemplates': () => ({ data: [] }),
  'whatsapp.createTemplate': () => ({ id: mintedId('tmpl') }),
  'whatsapp.deleteTemplate': () => ({ success: true }),

  'instagram.createMedia': () => ({ id: mintedId('igmedia') }),
  'instagram.publishMedia': () => ({ id: mintedId('igpost') }),
  'instagram.getSenderProfile': (c) => {
    const fields = requestedFields(c.parsed);
    // The same shape serves IG container status polling; `FINISHED` so the
    // publish loop proceeds immediately instead of spinning.
    if (fields.includes('status_code')) {
      return { status_code: 'FINISHED', status: 'Finished' };
    }
    return {
      id: nodeIdFrom(c.parsed),
      name: 'E2E Sender',
      username: 'e2e_sender',
    };
  },

  'node.get': respondNodeGet,
  // `POST /{id}` is the mutable-field write — rename, pause, resume, edit a
  // creative. It must land on the stored node, or the next list read serves the
  // pre-edit values and an "edit persists" assertion can only fail.
  'node.update': async (c) => {
    const body = jsonBody(c.body);
    const patch: Record<string, unknown> = { updated_time: nowIso() };
    for (const key of ['name', 'status', 'daily_budget', 'lifetime_budget']) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    // Pausing changes what `effective_status` reports; nothing else here does.
    if (str(body.status)) patch.effective_status = str(body.status);
    // Editing an ad re-points it at a NEW creative (`updateAd`), so the nested
    // creative a list read serves has to follow — that IS the edit, and
    // `edit-ad.connected.spec.ts` asserts it reads back.
    const creative = body.creative as { creative_id?: string } | undefined;
    if (creative?.creative_id) {
      patch.creative = await creativeNode(creative.creative_id);
    }
    await patchFakeObject(nodeIdFrom(c.parsed), patch);
    return { success: true };
  },
  'node.delete': async (c) => {
    await deleteFakeObject(nodeIdFrom(c.parsed));
    return { success: true };
  },
};
