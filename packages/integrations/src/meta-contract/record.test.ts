import { describe, expect, it, vi } from 'vitest';
import { GRAPH_API_BASE } from '../shared/graph-api.js';
import {
  type GraphRecording,
  buildRecording,
  createRecordingInterceptor,
} from './record.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('buildRecording — secret scrubbing', () => {
  it('never writes the access token from the query string', () => {
    const rec = buildRecording(
      `${GRAPH_API_BASE}/act_1/ads?access_token=LIVE_TOKEN&appsecret_proof=PROOF&fields=id,name`,
      { method: 'GET' },
      200,
      { data: [] }
    );

    const serialised = JSON.stringify(rec);
    expect(serialised).not.toContain('LIVE_TOKEN');
    expect(serialised).not.toContain('PROOF');

    // Non-secret params survive — they're needed to write response schemas.
    expect(rec.query.fields).toBe('id,name');
    expect(rec.query.access_token).toBe('REDACTED');
  });

  it('never writes the access token from a urlencoded body', () => {
    // The page-publish paths post urlencoded bodies with the token inline.
    const body = new URLSearchParams({
      url: 'https://cdn.example.com/x.jpg',
      message: 'hello',
      access_token: 'LIVE_TOKEN',
    }).toString();

    const rec = buildRecording(
      `${GRAPH_API_BASE}/page1/photos`,
      { method: 'POST', body },
      200,
      { id: '1' }
    );

    expect(JSON.stringify(rec)).not.toContain('LIVE_TOKEN');
    expect(rec.requestBody).toMatchObject({
      message: 'hello',
      access_token: 'REDACTED',
    });
  });

  it('scrubs secrets nested inside a JSON body', () => {
    const rec = buildRecording(
      `${GRAPH_API_BASE}/act_1/adcreatives`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: 'creative',
          object_story_spec: { page_id: '1', access_token: 'LIVE_TOKEN' },
        }),
      },
      200,
      { id: 'c1' }
    );

    expect(JSON.stringify(rec)).not.toContain('LIVE_TOKEN');
    expect(rec.requestBody).toMatchObject({
      object_story_spec: { page_id: '1', access_token: 'REDACTED' },
    });
  });

  it('scrubs secrets appearing in a response body', () => {
    const rec = buildRecording(
      `${GRAPH_API_BASE}/page1`,
      { method: 'GET' },
      200,
      { id: '1', access_token: 'PAGE_TOKEN' }
    );

    expect(JSON.stringify(rec)).not.toContain('PAGE_TOKEN');
  });

  it('keeps the path free of the query string entirely', () => {
    const rec = buildRecording(
      `${GRAPH_API_BASE}/act_1/ads?access_token=LIVE_TOKEN`,
      { method: 'POST' },
      200,
      {}
    );
    expect(rec.path).toBe('/act_1/ads');
  });
});

describe('buildRecording — labelling', () => {
  it('labels a known endpoint by registry id', () => {
    const rec = buildRecording(
      `${GRAPH_API_BASE}/act_1/campaigns`,
      { method: 'POST' },
      200,
      { id: 'c1' }
    );
    expect(rec.endpointId).toBe('ads.createCampaign');
  });

  it('labels an undeclared endpoint `unmatched` rather than dropping it', () => {
    // The whole point of a recording run is to discover call sites the static
    // enumeration missed, so these must be visible, not silently skipped.
    const rec = buildRecording(
      `${GRAPH_API_BASE}/act_1/brandnewthing`,
      { method: 'POST' },
      200,
      {}
    );
    expect(rec.endpointId).toBe('unmatched');
  });
});

describe('createRecordingInterceptor', () => {
  it('ignores non-Graph traffic entirely', async () => {
    const written: GraphRecording[] = [];
    const realFetch = vi.fn();
    vi.stubGlobal('fetch', realFetch);

    const intercept = createRecordingInterceptor({
      dir: '/unused',
      write: (r) => written.push(r),
    });

    const result = await intercept('https://bucket.s3.amazonaws.com/key', {});

    expect(result).toBeNull();
    expect(realFetch).not.toHaveBeenCalled();
    expect(written).toEqual([]);

    vi.unstubAllGlobals();
  });

  it('passes the real response through unchanged and still records it', async () => {
    const written: GraphRecording[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ id: 'real-1' }))
    );

    const intercept = createRecordingInterceptor({
      dir: '/unused',
      write: (r) => written.push(r),
    });

    const res = await intercept(`${GRAPH_API_BASE}/act_1/ads`, {
      method: 'POST',
      body: JSON.stringify({ name: 'ad' }),
    });

    // The caller must still be able to read the body — the recorder reads a
    // clone, never the original.
    expect(await res?.json()).toEqual({ id: 'real-1' });
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      endpointId: 'ads.createAd',
      status: 200,
      responseBody: { id: 'real-1' },
    });

    vi.unstubAllGlobals();
  });

  it('does not fail the request when recording throws', async () => {
    // Losing a sample is annoying; failing a live ad publish is not acceptable.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ id: 'real-1' }))
    );
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const intercept = createRecordingInterceptor({
      dir: '/unused',
      write: () => {
        throw new Error('disk full');
      },
    });

    const res = await intercept(`${GRAPH_API_BASE}/act_1/ads`, {
      method: 'POST',
    });

    expect(res?.status).toBe(200);
    expect(console.warn).toHaveBeenCalled();

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
