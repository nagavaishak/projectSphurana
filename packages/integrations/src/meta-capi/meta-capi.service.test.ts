/**
 * The HTTP layer is mocked — no test here may reach graph.facebook.com.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchWithRetry = vi.fn();
vi.mock('@borradh-workspace/http', () => ({ fetchWithRetry }));

const { MetaCapiService } = await import('./meta-capi.service.js');
const { MetaPixelsService } = await import('./meta-pixels.service.js');

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

const lastBody = () =>
  JSON.parse(
    (fetchWithRetry.mock.calls.at(-1)?.[1] as { body: string }).body
  ) as Record<string, unknown>;

describe('MetaCapiService.sendEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchWithRetry.mockResolvedValue(
      jsonResponse({ events_received: 1, fbtrace_id: 'trace-1' })
    );
  });

  const service = () =>
    new MetaCapiService({ accessToken: 'tok', pixelId: '99887766' });

  it('posts to the pixel events edge and hashes user data on the way out', async () => {
    const result = await service().sendEvents([
      {
        event_name: 'Schedule',
        event_time: 1_700_000_000,
        event_id: 'evt-abc',
        user_data: { email: 'Test@Example.com', firstName: 'Jane' },
        custom_data: { value: 60, currency: 'EUR' },
      },
    ]);

    expect(result.eventsReceived).toBe(1);
    const [url] = fetchWithRetry.mock.calls[0] as [string];
    expect(url).toContain('/99887766/events');

    const body = lastBody();
    const event = (body.data as Record<string, unknown>[])[0];
    const userData = event.user_data as Record<string, string[]>;
    // The raw address must not survive anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('Test@Example.com');
    expect(userData.em?.[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(event.action_source).toBe('website');
  });

  it('carries event_id through UNCHANGED — it is the dedup key', async () => {
    await service().sendEvents([
      {
        event_name: 'Purchase',
        event_time: 1_700_000_000,
        event_id: 'booking:appt-123',
        user_data: { email: 'a@b.com' },
      },
    ]);

    const event = (lastBody().data as Record<string, unknown>[])[0];
    expect(event.event_id).toBe('booking:appt-123');
  });

  it('throws a MetaApiError on a non-ok response', async () => {
    fetchWithRetry.mockResolvedValue(
      jsonResponse({ error: { message: 'Invalid parameter', code: 100 } }, 400)
    );

    await expect(
      service().sendEvents([
        {
          event_name: 'PageView',
          event_time: 1,
          event_id: 'x',
          user_data: {},
        },
      ])
    ).rejects.toThrow(/Invalid parameter/);
  });
});

describe('MetaPixelsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists pixels on the ad account, prefixing act_ when missing', async () => {
    fetchWithRetry.mockResolvedValue(
      jsonResponse({ data: [{ id: '123', name: 'Salon Pixel' }] })
    );

    const pixels = await new MetaPixelsService({
      accessToken: 'tok',
      adAccountId: '456',
    }).listPixels();

    expect(pixels).toEqual([{ id: '123', name: 'Salon Pixel' }]);
    expect(fetchWithRetry.mock.calls[0]?.[0]).toContain('/act_456/adspixels');
  });

  it('creates a pixel by POSTing to the same adspixels edge', async () => {
    fetchWithRetry.mockResolvedValue(jsonResponse({ id: '999' }));

    const pixel = await new MetaPixelsService({
      accessToken: 'tok',
      adAccountId: 'act_456',
    }).createPixel('Borradh Microsite');

    expect(pixel).toEqual({ id: '999', name: 'Borradh Microsite' });
    expect(fetchWithRetry.mock.calls[0]?.[1]).toMatchObject({ method: 'POST' });
  });
});
