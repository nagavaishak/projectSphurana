import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_API_BASE } from '../shared/graph-api.js';
import {
  createValidatingInterceptor,
  getDriftReports,
  getDriftSummary,
  isReportingMilestone,
  resetDriftReports,
  validateResponse,
} from './validate.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => resetDriftReports());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('validateResponse', () => {
  it('passes a response that matches the schema', () => {
    expect(
      validateResponse('ads.createCampaign', 'POST /act_1/campaigns', 200, {
        id: 'camp-1',
      })
    ).toBeNull();
  });

  it('tolerates NEW fields — passthrough, so a Meta release is a non-event', () => {
    // This is the whole reason response schemas are non-strict. If this ever
    // starts reporting drift, the nightly goes red on every Meta deploy.
    expect(
      validateResponse('ads.createCampaign', 'POST /act_1/campaigns', 200, {
        id: 'camp-1',
        some_field_meta_added_last_week: true,
      })
    ).toBeNull();
  });

  it('reports a MISSING field we actually read', () => {
    // `requireId` throws without this, so its absence is a real outage.
    const report = validateResponse(
      'ads.createCampaign',
      'POST /act_1/campaigns',
      200,
      { name: 'no id here' }
    );

    expect(report).not.toBeNull();
    expect(report?.issues.join()).toMatch(/id/);
  });

  it('reports a CHANGED type', () => {
    const report = validateResponse(
      'ads.createCampaign',
      'POST /act_1/campaigns',
      200,
      { id: 12345 }
    );
    expect(report).not.toBeNull();
  });

  it('ignores Meta error envelopes — a rate limit is not schema drift', () => {
    expect(
      validateResponse('ads.createCampaign', 'POST /act_1/campaigns', 400, {
        error: { message: 'rate limited', code: 17 },
      })
    ).toBeNull();

    expect(
      validateResponse('ads.createCampaign', 'POST /act_1/campaigns', 200, {
        error: { message: 'body-level error', code: 190 },
      })
    ).toBeNull();
  });

  it('skips endpoints with no declared response schema', () => {
    expect(
      validateResponse('pages.subscribeApp', 'POST /p/subscribed_apps', 200, {
        anything: true,
      })
    ).toBeNull();
  });

  it('accumulates reports for the run', () => {
    validateResponse('ads.createCampaign', 'a', 200, {});
    validateResponse('ads.createAd', 'b', 200, {});
    expect(getDriftReports()).toHaveLength(2);
  });
});

// These exist because this interceptor moved from a nightly CI process (starts,
// works, exits) into the long-lived API and worker. Everything below is about
// what that move made unbounded.
describe('bounded in a long-lived process', () => {
  it('counts a repeated drift without keeping a sample per occurrence', () => {
    for (let i = 0; i < 500; i += 1) {
      validateResponse('ads.createCampaign', `POST /act_${i}/campaigns`, 200, {
        name: 'no id here',
      });
    }

    // One SAMPLE, 500 occurrences. Before this, `drifts` held 500 objects and
    // grew for the life of the process.
    expect(getDriftReports()).toHaveLength(1);
    expect(getDriftReports()[0]?.occurrences).toBe(1);

    const summary = getDriftSummary();
    expect(summary.total).toBe(500);
    expect(summary.unique).toBe(1);
    expect(summary.truncated).toBe(true);
  });

  it('reports the occurrence count back to the caller', () => {
    const first = validateResponse('ads.createCampaign', 'a', 200, {});
    const second = validateResponse('ads.createCampaign', 'b', 200, {});

    expect(first?.occurrences).toBe(1);
    expect(second?.occurrences).toBe(2);
  });

  it('treats different issues on the same endpoint as different drifts', () => {
    validateResponse('ads.createCampaign', 'a', 200, { name: 'missing id' });
    validateResponse('ads.createCampaign', 'b', 200, { id: 12345 });

    expect(getDriftSummary().unique).toBe(2);
  });

  it('logs on first sight then once per decade, not once per call', () => {
    expect(isReportingMilestone(1)).toBe(true);
    expect(isReportingMilestone(10)).toBe(true);
    expect(isReportingMilestone(100)).toBe(true);
    expect(isReportingMilestone(1000)).toBe(true);

    expect(isReportingMilestone(2)).toBe(false);
    expect(isReportingMilestone(9)).toBe(false);
    expect(isReportingMilestone(11)).toBe(false);
    expect(isReportingMilestone(99)).toBe(false);

    // 0 is the "signature table was full" marker — it must never log.
    expect(isReportingMilestone(0)).toBe(false);
  });

  it('reset clears the counters, not just the samples', () => {
    validateResponse('ads.createCampaign', 'a', 200, {});
    validateResponse('ads.createCampaign', 'b', 200, {});
    resetDriftReports();

    expect(getDriftSummary()).toMatchObject({
      total: 0,
      unique: 0,
      truncated: false,
    });
    expect(getDriftReports()).toHaveLength(0);
  });
});

describe('unmatched endpoints on a production host', () => {
  // OAuth endpoints are deliberately absent from the registry. On prod that is
  // ordinary customer traffic, so without de-duplication every OAuth call would
  // emit a warning, forever.
  function unmatched(path: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    );
    return createValidatingInterceptor()(`${GRAPH_API_BASE}${path}`, {
      method: 'GET',
    });
  }

  it('de-duplicates by path SHAPE, not by entity id', async () => {
    await unmatched('/act_111/unknownedge');
    await unmatched('/act_222/unknownedge');
    await unmatched('/333/unknownedge');
    await unmatched('/444/unknownedge');

    // Two shapes: `act_{id}/unknownedge` and `{id}/unknownedge`. Keyed on the
    // raw path this would have been four distinct findings, and on a real ad
    // account it would be unbounded.
    const summary = getDriftSummary();
    expect(summary.unique).toBe(2);
    expect(summary.total).toBe(4);
  });

  it('stops tracking new signatures once the table is full', async () => {
    for (let i = 0; i < 320; i += 1) {
      await unmatched(`/shape-${i}/unknownedge`);
    }

    const summary = getDriftSummary();
    expect(summary.total).toBe(320);
    expect(summary.unique).toBeLessThanOrEqual(200);
    expect(summary.samples.length).toBeLessThanOrEqual(50);
  });
});

describe('createValidatingInterceptor', () => {
  it('ignores non-Graph traffic', async () => {
    const realFetch = vi.fn();
    vi.stubGlobal('fetch', realFetch);

    const intercept = createValidatingInterceptor();
    expect(await intercept('https://api.openai.com/v1/x', {})).toBeNull();
    expect(realFetch).not.toHaveBeenCalled();
  });

  it('returns the real response untouched and records drift', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ no_id_field: true }))
    );

    const intercept = createValidatingInterceptor();
    const res = await intercept(`${GRAPH_API_BASE}/act_1/campaigns`, {
      method: 'POST',
    });

    // The caller must still be able to read the body — we validate a clone.
    expect(await res?.json()).toEqual({ no_id_field: true });
    expect(getDriftReports()).toHaveLength(1);
    expect(getDriftReports()[0]?.endpointId).toBe('ads.createCampaign');
  });

  it('never fails the request when validation throws', async () => {
    // A schema bug must not take down a live ad publish.
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response('not json at all', { status: 200 }))
    );

    const intercept = createValidatingInterceptor();
    const res = await intercept(`${GRAPH_API_BASE}/act_1/campaigns`, {
      method: 'POST',
    });

    expect(res?.status).toBe(200);
  });

  it('is report-only — it does not reject or alter the response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ broken: true }, 200))
    );

    const intercept = createValidatingInterceptor();
    await expect(
      intercept(`${GRAPH_API_BASE}/act_1/campaigns`, { method: 'POST' })
    ).resolves.toBeInstanceOf(Response);
  });
});
