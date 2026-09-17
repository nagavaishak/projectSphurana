import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
// Same specifier the service uses (the integrations public barrel via relative
// path), so the spy intercepts the exact binding the service calls.
import * as integrationsModule from '../../../integrations/index.js';
import type { DbConnection } from '../../../shared/index.js';
import { ensureCampaignWhatsappTemplate } from './ensure-whatsapp-template.service.js';

const ORG = 'org_1';

describe('ensureCampaignWhatsappTemplate', () => {
  const mockDb = createMockDatabase();
  const db = mockDb as unknown as DbConnection;
  // Spy (not vi.mock) on the integrations public barrel — the service imports
  // `createWhatsappTemplate` from there (cross-context imports must go through
  // the barrel). Under `isolate: false` a bare-factory mock leaks onto the
  // shared worker graph, so a scoped spy is used instead.
  const createWhatsappTemplate = vi.spyOn(
    integrationsModule,
    'createWhatsappTemplate'
  );

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns missing_account when there is no active WABA', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await ensureCampaignWhatsappTemplate(db, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('missing_account');
    expect(createWhatsappTemplate).not.toHaveBeenCalled();
  });

  it('is a no-op reporting the current status when the template already exists', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa_1',
    });
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValueOnce({
      status: 'approved',
    });

    const result = await ensureCampaignWhatsappTemplate(db, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('approved');
    expect(createWhatsappTemplate).not.toHaveBeenCalled();
  });

  it('registers the canonical template and reports created when missing', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa_1',
    });
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValueOnce(null);
    createWhatsappTemplate.mockResolvedValueOnce({
      success: true,
      data: { id: 'meta_1', status: 'pending' },
    });

    const result = await ensureCampaignWhatsappTemplate(db, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.status).toBe('created');
    expect(createWhatsappTemplate).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        organizationId: ORG,
        accountId: 'wa_1',
        name: 'borradh_campaign_message',
        category: 'MARKETING',
        language: 'en_US',
      })
    );
  });

  it('propagates a registration failure', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa_1',
    });
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValueOnce(null);
    createWhatsappTemplate.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Meta rejected' },
    });

    const result = await ensureCampaignWhatsappTemplate(db, {
      organizationId: ORG,
    });

    expect(result.success).toBe(false);
  });

  it('rejects an empty organization id', async () => {
    const result = await ensureCampaignWhatsappTemplate(db, {
      organizationId: '',
    });
    expect(result.success).toBe(false);
  });
});
