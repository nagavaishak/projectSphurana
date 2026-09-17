import {
  MetaApiError,
  decryptCredentials,
  mockMetaAdsService,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { pollMetaLeadForms } from './poll-meta-lead-forms.service.js';

const mockListForms = vi.mocked(mockMetaAdsService.listAllLeadGenForms);
const mockGetLeads = vi.mocked(mockMetaAdsService.getFormLeadsSince);

const anHourAgo = () => new Date(Date.now() - 60 * 60 * 1000);
const aMinuteAgo = () => new Date(Date.now() - 60 * 1000);

const connectedPage = (overrides: Record<string, unknown> = {}) => ({
  id: 'page_row_1',
  pageId: '103713349194559',
  platform: 'facebook',
  isActive: true,
  pageAccessToken: 'encrypted_page_token',
  defaultAdAccountId: 'act_123',
  lastLeadPollAt: null,
  leadFormCounts: null,
  integration: {
    id: 'int_1',
    organizationId: 'org_1',
    isActive: true,
    tokenStatus: 'valid',
    adAccountId: 'act_123',
    encryptedCredentials: 'encrypted_user_token',
  },
  ...overrides,
});

describe('pollMetaLeadForms', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockListForms.mockReset();
    mockGetLeads.mockReset();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted_token',
    });
    // A real INSERT ... RETURNING hands back the new row. The mock defaults to
    // `[]`, which `createMetaFormLead` correctly reads as "lost the insert
    // race" — so leaving it unstubbed would silently turn every creation into
    // a duplicate.
    mockDb.returning.mockResolvedValue([{ id: 'lead_inserted' }]);
  });

  it('returns VALIDATION_ERROR for a negative lookback', async () => {
    const result = await pollMetaLeadForms(mockDb as never, {
      initialLookbackDays: -1,
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  // The core of ENG-786: Meta accepts our webhook subscription but never
  // POSTs. Reads still work, so the poll must produce the lead the webhook
  // never delivered.
  it('recovers a lead the webhook never delivered', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'meta_lead_1',
        formId: 'form_1',
        fieldData: [
          { name: 'full_name', values: ['Barbara Blair'] },
          { name: 'email', values: ['barbara@example.com'] },
        ],
        createdTime: aMinuteAgo().toISOString(),
        adId: 'ad_1',
        campaignId: '120243877231560358',
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadsCreated).toBe(1);
      expect(result.data.pagesPolled).toBe(1);
      expect(result.data.pagesFailed).toEqual([]);
    }

    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.facebookLeadId).toBe('meta_lead_1');
    expect(inserted.source).toBe('meta_lead_form');
    expect(inserted.firstName).toBe('Barbara');
    expect(inserted.email).toBe('barbara@example.com');
  });

  it('does not re-create a lead the webhook already ingested', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'meta_lead_1',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['Barbara Blair'] }],
        createdTime: aMinuteAgo().toISOString(),
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({ id: 'existing_lead' });

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadsCreated).toBe(0);
      expect(result.data.leadsDuplicate).toBe(1);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  // A backfill reaching 90 days back must capture the DATA without
  // cold-messaging hundreds of people who filled a form weeks ago.
  it('ingests a stale lead without arming Claire or a sequence', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    const staleSubmittedAt = anHourAgo().toISOString();
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'old_lead',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['Old Lead'] }],
        createdTime: staleSubmittedAt,
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await pollMetaLeadForms(mockDb as never, {
      activationWindowMinutes: 5,
    });

    expect(result.success).toBe(true);
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.facebookLeadId).toBe('old_lead');
    // No sequence auto-start: the lead is data, not a live conversation.
    expect(inserted.sequenceId).toBeUndefined();
    expect(inserted.sequenceStatus).toBeUndefined();
    expect(inserted.metadata.recoveredByPoll).toBe(true);
    // Stamped with the real submission time, NOT the backfill time — otherwise
    // 90-day-old enquiries surface as leads that "arrived today".
    expect(inserted.createdAt.toISOString()).toBe(
      new Date(staleSubmittedAt).toISOString()
    );
    // The sequence lookup must not even run for a stale lead.
    expect(mockDb.query.sequence.findMany).not.toHaveBeenCalled();
  });

  // What "message them if they haven't been messaged" means in practice: the
  // opener is queued for a STALE lead, but a sequence and a push notification
  // still are not — one message, not a campaign.
  it('contacts a stale lead when asked, without arming a sequence', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'silent_lead',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['Never Contacted'] }],
        createdTime: anHourAgo().toISOString(),
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await pollMetaLeadForms(mockDb as never, {
      activationWindowMinutes: 5,
      contactRecovered: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadsCreated).toBe(1);
      expect(result.data.staleLeadsContacted).toBe(1);
    }
    const inserted = mockDb.values.mock.calls[0][0];
    // Contacted, but NOT dropped into a sequence.
    expect(inserted.sequenceId).toBeUndefined();
    expect(inserted.metadata.recoveredByPoll).toBe(true);
    expect(mockDb.query.sequence.findMany).not.toHaveBeenCalled();
  });

  it('does not contact stale leads by default', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'silent_lead',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['Never Contacted'] }],
        createdTime: anHourAgo().toISOString(),
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await pollMetaLeadForms(mockDb as never, {
      activationWindowMinutes: 5,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.staleLeadsContacted).toBe(0);
  });

  // Connecting a Facebook page must import the clinic's existing lead history,
  // so a new customer does not land on an empty list. A null cursor is what
  // triggers it — hence no column default on `last_lead_poll_at`.
  it('imports 90 days of history for a newly connected page', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({ lastLeadPollAt: null }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE', leadsCount: 3 },
    ]);
    mockGetLeads.mockResolvedValueOnce([]);

    await pollMetaLeadForms(mockDb as never);

    expect(mockGetLeads).toHaveBeenCalledTimes(1);
    const [, opts] = mockGetLeads.mock.calls[0] as [string, { since: Date }];
    const daysBack = (Date.now() - opts.since.getTime()) / 864e5;
    expect(daysBack).toBeGreaterThan(89);
    expect(daysBack).toBeLessThan(91);
  });

  // An archived form still holds history, so onboarding must read it — but the
  // steady-state poll should not keep paying for forms that can take no leads.
  it('reads archived forms during the first import only', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({ lastLeadPollAt: null }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_old', name: 'Old', status: 'ARCHIVED', leadsCount: 9 },
    ]);
    mockGetLeads.mockResolvedValueOnce([]);

    await pollMetaLeadForms(mockDb as never);

    expect(mockGetLeads).toHaveBeenCalledWith('form_old', expect.anything());
  });

  // The recovery script rewinds the cursor to a real date, so isBackfill is
  // false there. Without the explicit flag, archived forms — the campaigns that
  // have ENDED, i.e. exactly what a recovery run is for — would be skipped, and
  // the run would still report success.
  it('reads archived forms on a rewound-cursor recovery run', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({ lastLeadPollAt: new Date(Date.now() - 90 * 864e5) }),
    ]);
    mockListForms.mockResolvedValueOnce([
      {
        id: 'form_ended',
        name: 'Ended campaign',
        status: 'ARCHIVED',
        leadsCount: 40,
      },
    ]);
    mockGetLeads.mockResolvedValueOnce([]);

    await pollMetaLeadForms(mockDb as never, { includeArchivedForms: true });

    expect(mockGetLeads).toHaveBeenCalledWith('form_ended', expect.anything());
  });

  it('skips archived forms on a steady-state tick', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({ lastLeadPollAt: aMinuteAgo() }),
    ]);
    mockListForms.mockResolvedValueOnce([
      {
        id: 'form_ended',
        name: 'Ended campaign',
        status: 'ARCHIVED',
        leadsCount: 40,
      },
    ]);

    await pollMetaLeadForms(mockDb as never);

    expect(mockGetLeads).not.toHaveBeenCalled();
  });

  // This count is printed to the operator as "openers queued". A duplicate
  // queues nothing, so counting it would overstate how many real people were
  // messaged — the one number here that must never be optimistic.
  it('does not count an opener for a lead that was already imported', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'already_here',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['Already Imported'] }],
        createdTime: anHourAgo().toISOString(),
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({ id: 'existing' });

    const result = await pollMetaLeadForms(mockDb as never, {
      activationWindowMinutes: 5,
      contactRecovered: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadsDuplicate).toBe(1);
      expect(result.data.staleLeadsContacted).toBe(0);
    }
  });

  // The webhook and the 5-minute poll can process the same leadgen_id at once
  // and BOTH pass the pre-check before either writes. The partial unique index
  // makes the loser's insert a no-op; this asserts we then report a duplicate
  // rather than claiming a lead we did not create — which would queue a second
  // Claire opener to the same person.
  it('reports a duplicate when it loses the insert race', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'raced_lead',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['Raced Person'] }],
        createdTime: aMinuteAgo().toISOString(),
      },
    ]);
    // Pre-check sees nothing — the webhook has not committed yet...
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequence.findMany.mockResolvedValueOnce([]);
    // ...but by the time we INSERT it has, so ON CONFLICT DO NOTHING returns
    // no row.
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadsCreated).toBe(0);
      expect(result.data.leadsDuplicate).toBe(1);
    }
  });

  // Deploy cold start: ~1,000 Graph calls across all pages, every one of them
  // asking for leads newer than a cursor that was just set to now.
  it('seeds counts without reading leads on a cold start', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({ lastLeadPollAt: new Date(), leadFormCounts: null }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_a', name: 'A', status: 'ACTIVE', leadsCount: 12 },
      { id: 'form_b', name: 'B', status: 'ACTIVE', leadsCount: 4 },
    ]);

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    expect(mockGetLeads).not.toHaveBeenCalled();
    // Counts are stored, so the NEXT tick can tell when one moves.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ leadFormCounts: { form_a: 12, form_b: 4 } })
    );
  });

  it('does not seed-skip a recovery run, which also starts countless', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({
        lastLeadPollAt: new Date(Date.now() - 90 * 864e5),
        leadFormCounts: {},
      }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_a', name: 'A', status: 'ARCHIVED', leadsCount: 12 },
    ]);
    mockGetLeads.mockResolvedValueOnce([]);

    await pollMetaLeadForms(mockDb as never, { includeArchivedForms: true });

    // Seeding here would import nothing at all.
    expect(mockGetLeads).toHaveBeenCalledWith('form_a', expect.anything());
  });

  it('does not seed-skip when the cursor is stale', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({
        lastLeadPollAt: new Date(Date.now() - 6 * 3600_000),
        leadFormCounts: null,
      }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_a', name: 'A', status: 'ACTIVE', leadsCount: 12 },
    ]);
    mockGetLeads.mockResolvedValueOnce([]);

    await pollMetaLeadForms(mockDb as never);

    // A stale cursor means there IS a real window to read.
    expect(mockGetLeads).toHaveBeenCalledWith('form_a', expect.anything());
  });

  it('advances the page cursor to the newest lead seen', async () => {
    const newest = aMinuteAgo();
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([connectedPage()]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'Consultation', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'meta_lead_1',
        formId: 'form_1',
        fieldData: [{ name: 'full_name', values: ['A B'] }],
        createdTime: newest.toISOString(),
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

    await pollMetaLeadForms(mockDb as never);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ lastLeadPollAt: newest })
    );
  });

  // The cost control: one `leadgen_forms` call per page, and a form is only
  // read when Meta says its lead total moved.
  it('skips forms whose leads_count has not moved since the last run', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({
        lastLeadPollAt: aMinuteAgo(),
        leadFormCounts: { form_quiet: 12, form_busy: 3 },
      }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_quiet', name: 'Quiet', status: 'ACTIVE', leadsCount: 12 },
      { id: 'form_busy', name: 'Busy', status: 'ACTIVE', leadsCount: 4 },
    ]);
    mockGetLeads.mockResolvedValueOnce([
      {
        id: 'new_lead',
        formId: 'form_busy',
        fieldData: [{ name: 'full_name', values: ['New Person'] }],
        createdTime: aMinuteAgo().toISOString(),
      },
    ]);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);
    mockDb.query.metaAd.findFirst.mockResolvedValueOnce(null);
    mockDb.query.sequence.findMany.mockResolvedValueOnce([]);

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.formsScanned).toBe(1); // only form_busy
      expect(result.data.leadsCreated).toBe(1);
    }
    expect(mockGetLeads).toHaveBeenCalledTimes(1);
    expect(mockGetLeads).toHaveBeenCalledWith('form_busy', expect.anything());
    // Counts are rolled forward for BOTH forms, including the skipped one.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        leadFormCounts: { form_quiet: 12, form_busy: 4 },
      })
    );
  });

  // "Unknown" must never be read as "nothing new" — that would silently stop
  // polling a form, recreating the exact failure this job exists to catch.
  it('still reads a form when Meta reports no leads_count', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({
        lastLeadPollAt: aMinuteAgo(),
        leadFormCounts: { form_1: 5 },
      }),
    ]);
    mockListForms.mockResolvedValueOnce([
      { id: 'form_1', name: 'No count', status: 'ACTIVE' },
    ]);
    mockGetLeads.mockResolvedValueOnce([]);

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    expect(mockGetLeads).toHaveBeenCalledTimes(1);
  });

  it('skips a page whose integration token is not valid', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage({
        integration: {
          id: 'int_1',
          organizationId: 'org_1',
          isActive: true,
          tokenStatus: 'needs_reconnect',
          adAccountId: 'act_123',
          encryptedCredentials: 'encrypted_user_token',
        },
      }),
    ]);

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pagesSkipped).toBe(1);
      expect(result.data.pagesPolled).toBe(0);
    }
    expect(mockListForms).not.toHaveBeenCalled();
  });

  // One dead page must not stall the whole run, and its cursor must NOT
  // advance — otherwise the failed window is skipped forever.
  it('isolates a failing page and leaves its cursor untouched', async () => {
    mockDb.query.metaAdsPage.findMany.mockResolvedValueOnce([
      connectedPage(),
      connectedPage({ id: 'page_row_2', pageId: '999' }),
    ]);
    mockListForms.mockRejectedValueOnce(
      new MetaApiError({
        error: {
          message: 'Error validating access token',
          code: 190,
          error_subcode: 460,
        },
      })
    );
    mockListForms.mockResolvedValueOnce([]);
    // markMetaAdsNeedsReconnect looks the integration up before flipping it.
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_1',
      tokenStatus: 'valid',
    });

    const result = await pollMetaLeadForms(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pagesFailed).toEqual(['103713349194559']);
      expect(result.data.pagesPolled).toBe(1);
    }
    // A 190 is an auth error, so the integration is flagged for reconnect...
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ tokenStatus: 'needs_reconnect' })
    );
    // ...and only ONE cursor is written — the surviving page's. The failed
    // page keeps its old cursor so the next run retries the same window
    // instead of skipping over it.
    const cursorWrites = mockDb.set.mock.calls.filter(
      ([values]: [Record<string, unknown>]) => 'lastLeadPollAt' in values
    );
    expect(cursorWrites).toHaveLength(1);
  });
});
