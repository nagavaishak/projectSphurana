import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';

import { mockMetaMessagingService } from '../../../__mocks__/integrations-meta-messaging.js';
import { subscribeMetaPageWebhooks } from './subscribe-meta-page-webhooks.service.js';

const page = (over: Record<string, unknown> = {}) => ({
  id: 'row1',
  pageId: '100',
  pageName: 'Shine by S',
  pageAccessToken: 'enc',
  isActive: true,
  ...over,
});

const dbWith = (rows: unknown[]) =>
  ({
    query: { metaAdsPage: { findMany: vi.fn().mockResolvedValue(rows) } },
  }) as never;

describe('subscribeMetaPageWebhooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptCredentials).mockImplementation(
      (blob: unknown) => ({ accessToken: `tok:${String(blob)}` }) as never
    );
    mockMetaMessagingService.subscribeToMessaging.mockResolvedValue({
      success: true,
    });
  });

  it('re-subscribes every active page with its own decrypted token', async () => {
    const result = await subscribeMetaPageWebhooks(
      dbWith([page(), page({ id: 'row2', pageId: '200', pageName: 'Other' })])
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.subscribed).toBe(2);
    expect(mockMetaMessagingService.subscribeToMessaging).toHaveBeenCalledTimes(
      2
    );
    expect(MetaMessagingService).toHaveBeenCalledWith({
      pageAccessToken: 'tok:enc',
      pageId: '100',
    });
  });

  it('skips a page with no stored token rather than throwing', async () => {
    const result = await subscribeMetaPageWebhooks(
      dbWith([page({ pageAccessToken: null })])
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ skipped: 1, subscribed: 0 });
    expect(
      mockMetaMessagingService.subscribeToMessaging
    ).not.toHaveBeenCalled();
  });

  it('keeps going when one page fails, and names it in the details', async () => {
    // The failure mode that matters: one clinic's expired token must not stop
    // every other clinic from getting the echo subscription.
    mockMetaMessagingService.subscribeToMessaging
      .mockRejectedValueOnce(new Error('token expired'))
      .mockResolvedValueOnce({ success: true });

    const result = await subscribeMetaPageWebhooks(
      dbWith([page(), page({ id: 'row2', pageId: '200', pageName: 'Other' })])
    );

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({ total: 2, subscribed: 1, failed: 1 });
    expect(result.data.details).toContainEqual({
      pageName: 'Shine by S',
      pageId: '100',
      status: 'failed',
      error: 'token expired',
    });
  });
});
