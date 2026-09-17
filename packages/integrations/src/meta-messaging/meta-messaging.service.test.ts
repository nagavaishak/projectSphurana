import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaMessagingService } from './meta-messaging.service.js';

const ACCESS_TOKEN = 'page-token';
const PAGE_ID = 'page-123';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: new Headers(),
    body: { cancel: vi.fn().mockResolvedValue(undefined) },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('MetaMessagingService', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('retries transient Graph API failures before returning a profile', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    fetchMock
      .mockResolvedValueOnce(jsonResponse(500, { error: { message: 'Oops' } }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          id: 'user-123',
          name: 'Pat Customer',
        })
      );

    const service = new MetaMessagingService({
      pageAccessToken: ACCESS_TOKEN,
      pageId: PAGE_ID,
    });

    await expect(service.getUserProfile('user-123')).resolves.toMatchObject({
      id: 'user-123',
      name: 'Pat Customer',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
