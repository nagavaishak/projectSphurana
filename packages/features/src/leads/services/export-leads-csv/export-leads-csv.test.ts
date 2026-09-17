import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { exportLeadsToCsv } from './export-leads-csv.service.js';

describe('exportLeadsToCsv', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const HEADER =
    'First Name,Last Name,Email,Phone,WhatsApp,Source,Status,Tags,Notes,Consent Email,Consent SMS,Consent Voice,Created At';

  it('emits the header row even when there are no leads', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await exportLeadsToCsv(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.csv).toBe(HEADER);
    }
  });

  it('serialises a lead row with tags joined and booleans as Yes/No', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.com',
        phone: '+353850000000',
        whatsapp: null,
        source: 'manual',
        status: 'new',
        tags: ['vip', 'referral'],
        notes: null,
        consentEmail: true,
        consentSms: false,
        consentVoice: false,
        createdAt: new Date('2026-01-02T03:04:05.000Z'),
      },
    ]);

    const result = await exportLeadsToCsv(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    const [header, row] = result.data.csv.split('\n');
    expect(header).toBe(HEADER);
    expect(row).toBe(
      'Ada,Lovelace,ada@example.com,+353850000000,,manual,new,vip; referral,,Yes,No,No,2026-01-02T03:04:05.000Z'
    );
  });

  it('quotes fields containing a comma, quote or newline', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        firstName: 'Ada, the "first"',
        lastName: 'line1\nline2',
        email: null,
        phone: null,
        whatsapp: null,
        source: null,
        status: null,
        tags: null,
        notes: null,
        consentEmail: false,
        consentSms: false,
        consentVoice: false,
        createdAt: null,
      },
    ]);

    const result = await exportLeadsToCsv(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.csv).toContain('"Ada, the ""first"""');
    expect(result.data.csv).toContain('"line1\nline2"');
  });

  it('names the file with the current UTC date', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await exportLeadsToCsv(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.filename).toBe(
        `leads-export-${new Date().toISOString().slice(0, 10)}.csv`
      );
    }
  });

  it('returns VALIDATION_ERROR when the organization is missing', async () => {
    const result = await exportLeadsToCsv(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.lead.findMany).not.toHaveBeenCalled();
  });
});
