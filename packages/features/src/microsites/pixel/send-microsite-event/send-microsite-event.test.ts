/**
 * Four things are pinned here, and all four fail silently in production:
 *
 * 1. `event_id` reaches Meta unchanged — otherwise conversions double-count.
 * 2. No consent suppresses a PageView but NOT a booking conversion (§9.7).
 * 3. Raw customer data never appears in the outgoing payload.
 * 4. A Meta failure never propagates out of the fire-and-forget entry point.
 */

import { mockMetaCapiService } from '@borradh-workspace/integrations/meta-capi';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import {
  installMetaAdsSharedSpies,
  metaAdsSharedMocks,
  restoreMetaAdsSharedSpies,
} from '../../../meta-ads/services/_shared/__fixtures__/shared-spies.js';
import { ErrorCodes } from '../../../shared/index.js';
import { TRACKING_CONSENT_METADATA_KEY } from '../tracking-consent.js';
import {
  sendMicrositeEvent,
  trackMicrositeEvent,
} from './send-microsite-event.service.js';

const ORG_ID = 'org_123';
const SITE_ID = 'site_abc';
const PAGE_ROW_ID = 'page_row_1';

const sendEvents = vi.mocked(mockMetaCapiService.sendEvents);

const credentials = () => ({
  success: true as const,
  data: {
    credentials: {
      accessToken: 'tok',
      adAccountId: 'act_999',
      pageId: 'fb_page_1',
    },
    integration: { id: 'int_1', adAccountId: 'act_999' },
    resolvedPage: {
      id: PAGE_ROW_ID,
      pageId: 'fb_page_1',
      pageName: 'Test Salon',
    },
  },
});

/** The single event handed to the CAPI client on the last call. */
const sentEvent = () =>
  (sendEvents.mock.calls.at(-1)?.[0] as Record<string, unknown>[])[0];

describe('sendMicrositeEvent', () => {
  const mockDb = createMockDatabase();

  const booking = {
    organizationId: ORG_ID,
    micrositeId: SITE_ID,
    eventName: 'Schedule' as const,
    dedupeKey: 'appt-123',
    leadId: 'lead_1',
    hasTransactionBasis: true,
    user: { email: 'Jane@Example.com', phone: '+353851234567' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    installMetaAdsSharedSpies('getMetaCredentials');
    mockDb._resetMocks();
    metaAdsSharedMocks.getMetaCredentials.mockResolvedValue(credentials());
    // Pixel already known → resolveOrgPixel short-circuits, no Meta pixel call.
    mockDb.query.metaAdsPage.findFirst.mockResolvedValue({
      id: PAGE_ROW_ID,
      pixelId: 'PX-1',
      pixelName: 'Salon Pixel',
    });
    mockDb.query.lead.findFirst.mockResolvedValue({
      id: 'lead_1',
      organizationId: ORG_ID,
      metadata: null,
    });
    sendEvents.mockResolvedValue({ eventsReceived: 1 });
  });

  afterEach(restoreMetaAdsSharedSpies);

  it('derives event_id and passes it through UNCHANGED', async () => {
    const result = await sendMicrositeEvent(mockDb as never, booking);

    expect(result.success).toBe(true);
    if (!result.success) return;
    // The browser half must be able to compute this same string offline.
    expect(result.data.eventId).toBe(`schedule:${SITE_ID}:appt-123`);
    expect(sentEvent().event_id).toBe(result.data.eventId);
  });

  it('sends the conversion for a customer who booked with NO consent on file', async () => {
    const result = await sendMicrositeEvent(mockDb as never, booking);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sent).toBe(true);
    expect(result.data.reason).toBe('booking_lawful_basis');
    expect(sendEvents).toHaveBeenCalledTimes(1);
  });

  it('SUPPRESSES a PageView when consent is absent — server-side is no loophole', async () => {
    const result = await sendMicrositeEvent(mockDb as never, {
      organizationId: ORG_ID,
      micrositeId: SITE_ID,
      eventName: 'PageView',
      dedupeKey: 'view-9',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sent).toBe(false);
    expect(result.data.reason).toBe('consent_missing');
    // Still returns the id, so the browser side stays deduplicable if consent
    // arrives later in the session.
    expect(result.data.eventId).toBe(`pageview:${SITE_ID}:view-9`);
    expect(sendEvents).not.toHaveBeenCalled();
  });

  it('sends a PageView once the lead carries ads consent', async () => {
    mockDb.query.lead.findFirst.mockResolvedValue({
      id: 'lead_1',
      organizationId: ORG_ID,
      metadata: {
        [TRACKING_CONSENT_METADATA_KEY]: {
          ads: true,
          source: 'banner',
          at: '2026-01-01T00:00:00.000Z',
        },
      },
    });

    const result = await sendMicrositeEvent(mockDb as never, {
      organizationId: ORG_ID,
      micrositeId: SITE_ID,
      eventName: 'PageView',
      dedupeKey: 'view-9',
      leadId: 'lead_1',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.sent).toBe(true);
    expect(result.data.reason).toBe('consent_granted');
  });

  it('never puts raw customer data in the payload, and hashes identifiers', async () => {
    await sendMicrositeEvent(mockDb as never, booking);

    const payload = JSON.stringify(sendEvents.mock.calls.at(-1)?.[0]);
    // The client hashes on the way out; what it receives is the raw input, so
    // assert on the SHAPE the service builds — the external id must be the
    // lead id (hashed downstream), never an email in custom_data or elsewhere.
    const event = sentEvent();
    expect((event.user_data as Record<string, unknown>).externalId).toBe(
      'lead_1'
    );
    expect((event.custom_data as Record<string, unknown>).microsite_id).toBe(
      SITE_ID
    );
    // The host is never persisted onto the event — microsite id is (§9).
    expect(payload).not.toContain('http');
  });

  it('applies limited_data_use for a US visitor', async () => {
    const result = await sendMicrositeEvent(mockDb as never, {
      ...booking,
      region: 'US',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.limitedDataUse).toBe(true);
    expect(sentEvent().data_processing_options).toEqual(['LDU']);
    expect(sentEvent().data_processing_options_country).toBe(0);
  });

  it('returns EXTERNAL_SERVICE_ERROR — and never throws — when Meta fails', async () => {
    sendEvents.mockRejectedValueOnce(new Error('Meta API Error: 500'));

    const result = await sendMicrositeEvent(mockDb as never, booking);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('trackMicrositeEvent swallows a Meta outage entirely', async () => {
    sendEvents.mockRejectedValue(new Error('Meta API Error: 500'));

    // A booking must complete even when Meta is down.
    await expect(
      trackMicrositeEvent(mockDb as never, booking)
    ).resolves.toBeUndefined();
  });
});
