import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import type { DbConnection } from '../../../shared/index.js';
import { listSampleRecipients } from './list-sample-recipients.service.js';

const ORG = 'org_1';

const makeLead = (over: Record<string, unknown>) => ({
  id: 'l',
  firstName: 'Ada',
  email: 'ada@example.com',
  phone: '+15550000001',
  whatsapp: '+15550000001',
  consentEmail: true,
  consentSms: true,
  ...over,
});

describe('listSampleRecipients', () => {
  const mockDb = createMockDatabase();
  const db = mockDb as unknown as DbConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns eligible leads for the channel, up to the limit', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      makeLead({ id: 'l1', firstName: 'Ada' }),
      makeLead({ id: 'l2', firstName: 'Grace' }),
      makeLead({ id: 'l3', firstName: 'Lin' }),
    ]);
    mockDb.query.suppression.findMany.mockResolvedValueOnce([]);

    const result = await listSampleRecipients(db, {
      organizationId: ORG,
      filterJson: {},
      channel: 'email',
      limit: 2,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recipients).toHaveLength(2);
      expect(result.data.recipients[0]).toEqual({
        leadId: 'l1',
        firstName: 'Ada',
        email: 'ada@example.com',
        phone: '+15550000001',
        whatsapp: '+15550000001',
      });
    }
  });

  it('excludes leads ineligible on the channel (no email consent)', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      makeLead({ id: 'l1', consentEmail: false }),
      makeLead({ id: 'l2', consentEmail: true }),
    ]);
    mockDb.query.suppression.findMany.mockResolvedValueOnce([]);

    const result = await listSampleRecipients(db, {
      organizationId: ORG,
      filterJson: {},
      channel: 'email',
      limit: 12,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recipients.map((r) => r.leadId)).toEqual(['l2']);
    }
  });

  it('excludes suppressed contacts', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      makeLead({ id: 'l1', email: 'blocked@example.com' }),
      makeLead({ id: 'l2', email: 'ok@example.com' }),
    ]);
    mockDb.query.suppression.findMany.mockResolvedValueOnce([
      { channel: 'email', contact: 'blocked@example.com' },
    ]);

    const result = await listSampleRecipients(db, {
      organizationId: ORG,
      filterJson: {},
      channel: 'email',
      limit: 12,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recipients.map((r) => r.leadId)).toEqual(['l2']);
    }
  });

  it('returns an empty list when the segment has no eligible leads', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);
    mockDb.query.suppression.findMany.mockResolvedValueOnce([]);

    const result = await listSampleRecipients(db, {
      organizationId: ORG,
      filterJson: {},
      channel: 'whatsapp',
      limit: 12,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.recipients).toEqual([]);
  });

  it('rejects an empty organization id', async () => {
    const result = await listSampleRecipients(db, {
      organizationId: '',
      filterJson: {},
      channel: 'email',
      limit: 12,
    });
    expect(result.success).toBe(false);
  });
});
