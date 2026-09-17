import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaAdsService } from '../../meta-ads/meta-ads.service.js';
import { GRAPH_API_BASE } from '../../shared/graph-api.js';
import { createMetaFakeInterceptor } from './index.js';

/**
 * MEDIA UPLOAD through the fake — driven by the REAL service, not by
 * hand-built requests.
 *
 * These exist because a hand-written fake test passed while the real path was
 * broken. The upload bodies are `Buffer`s (hand-built multipart), and an
 * earlier `bodyAsString` returned `null` for anything non-string. Every phase
 * of a chunked upload therefore looked like a single-shot upload: `start` got
 * `{ id }` back with no `upload_session_id`, and any video over the 20 MB
 * chunking threshold could not be stubbed at all.
 *
 * The only way to catch that class of bug is to run the actual uploader against
 * the fake, so that's what these do.
 */

const CREDENTIALS = {
  accessToken: 'test-token',
  adAccountId: '123456',
  pageId: 'page-1',
};

const fake = createMetaFakeInterceptor();

/** Every Graph body the service sent, decoded enough to read the phase. */
const sentBodies: string[] = [];

/** How many requests of each upload phase the service actually made. */
function uploadPhasesSeen(): {
  start: number;
  transfer: number;
  finish: number;
} {
  const count = (needle: RegExp) =>
    sentBodies.filter((b) => needle.test(b)).length;
  return {
    start: count(/"upload_phase"\s*:\s*"start"/),
    transfer: count(/name="upload_phase"\r?\n\r?\ntransfer/),
    finish: count(/"upload_phase"\s*:\s*"finish"/),
  };
}

/** Route the service's fetch through the fake, and serve its media download. */
function installFakeFetch(mediaBytes: number) {
  sentBodies.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes('graph.facebook.com') && init.body != null) {
        // Decode only the front — a 4 MB chunk's headers are all we need.
        const body = init.body;
        sentBodies.push(
          typeof body === 'string'
            ? body
            : new TextDecoder('utf-8', { fatal: false }).decode(
                new Uint8Array(
                  (body as ArrayBufferView).buffer,
                  (body as ArrayBufferView).byteOffset,
                  Math.min((body as ArrayBufferView).byteLength, 2048)
                )
              )
        );
      }
      // The uploader downloads the source media itself before posting to Meta.
      if (!url.includes('graph.facebook.com')) {
        return new Response(new Uint8Array(mediaBytes), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        });
      }
      const response = await fake(url, init);
      if (!response) throw new Error(`fake did not handle ${url}`);
      return response;
    })
  );
}

let service: MetaAdsService;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  service = new MetaAdsService(CREDENTIALS);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('video upload through the fake', () => {
  it('completes a SINGLE-shot upload (under the 20 MB threshold)', async () => {
    installFakeFetch(1024);

    const result = await service.uploadVideo(
      'https://cdn.borradh.io/small.mp4',
      'Small clip'
    );

    expect(result.videoId).toMatch(/^vid-/);
  });

  it('completes a CHUNKED upload AND actually transfers the chunks', async () => {
    // 24 MB forces the start/transfer/finish protocol.
    //
    // Asserting only on the returned videoId is NOT enough, and that is the
    // whole lesson of this bug: with a broken `start` response the offsets
    // parse to NaN, `while (startOffset < endOffset)` is immediately false, the
    // transfer loop never runs, and the uploader returns a perfectly
    // healthy-looking videoId having sent ZERO bytes. So count the phases.
    installFakeFetch(24 * 1024 * 1024);

    const result = await service.uploadVideo(
      'https://cdn.borradh.io/big.mp4',
      'Big clip'
    );

    expect(result.videoId).toMatch(/^vid-/);

    const phases = uploadPhasesSeen();
    expect(phases.start, 'no start phase').toBe(1);
    expect(phases.finish, 'no finish phase').toBe(1);

    // 24 MB in 4 MB chunks = 6 transfers. Asserting the EXACT count is what
    // makes this test able to fail: a fake that converges the offsets early
    // terminates the loop after one chunk and uploads 4 MB of a 24 MB video,
    // while still returning a healthy videoId.
    expect(phases.transfer, 'not every chunk was transferred').toBe(6);
  });

  it('answers the chunked phases with distinct, correctly-shaped payloads', async () => {
    const path = '/act_123456/advideos';

    const start = await fake(`${GRAPH_API_BASE}${path}`, {
      method: 'POST',
      body: JSON.stringify({ upload_phase: 'start', file_size: '24000000' }),
    });
    const startBody = (await start?.json()) as Record<string, string>;

    // Without a session id the uploader has nothing to continue with.
    expect(startBody.upload_session_id).toMatch(/^ups-/);
    expect(Number(startBody.end_offset)).toBeGreaterThan(
      Number(startBody.start_offset)
    );

    // `transfer` arrives as MULTIPART, not JSON — the encoding an earlier
    // version failed to parse.
    const multipart = Buffer.from(
      '------MetaChunk123\r\nContent-Disposition: form-data; name="upload_phase"\r\n\r\ntransfer\r\n'
    );
    const transfer = await fake(`${GRAPH_API_BASE}${path}`, {
      method: 'POST',
      body: multipart,
    });
    const transferBody = (await transfer?.json()) as Record<string, string>;

    expect(transferBody.start_offset).toBeDefined();
    expect(transferBody.upload_session_id).toBeUndefined();
    // Converged offsets terminate the loop.
    expect(transferBody.start_offset).toBe(transferBody.end_offset);

    const finish = await fake(`${GRAPH_API_BASE}${path}`, {
      method: 'POST',
      body: JSON.stringify({ upload_phase: 'finish' }),
    });
    expect(await finish?.json()).toMatchObject({ success: true });
  });

  it('keeps the session id stable across phases (path-seeded, not body-seeded)', async () => {
    // The multipart boundary embeds Date.now(); a body-seeded id would differ
    // between phases and lose the session.
    const path = `${GRAPH_API_BASE}/act_123456/advideos`;
    const body = JSON.stringify({ upload_phase: 'start', file_size: '1' });

    const first = (await (
      await fake(path, { method: 'POST', body })
    )?.json()) as {
      upload_session_id: string;
    };
    const second = (await (
      await fake(path, { method: 'POST', body })
    )?.json()) as { upload_session_id: string };

    expect(first.upload_session_id).toBe(second.upload_session_id);
  });
});

describe('image upload through the fake', () => {
  it('returns a hash the real uploader can read', async () => {
    installFakeFetch(2048);

    const result = await service.uploadImage(
      'https://cdn.borradh.io/photo.jpg'
    );

    // The service does Object.keys(data.images)[0], so the outer key is
    // arbitrary — but the nested hash must be present or it throws.
    expect(result.imageHash).toMatch(/^imghash-/);
  });

  it('returns a stable hash for the same account (multipart boundary varies)', async () => {
    installFakeFetch(2048);
    const a = await service.uploadImage('https://cdn.borradh.io/photo.jpg');
    const b = await service.uploadImage('https://cdn.borradh.io/photo.jpg');
    expect(a.imageHash).toBe(b.imageHash);
  });
});
