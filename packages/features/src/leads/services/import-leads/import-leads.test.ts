import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { importLeads } from './import-leads.service.js';

describe('importLeads', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const baseInput = {
    organizationId: 'org_123',
    deduplicateBy: 'email' as const,
    onDuplicate: 'skip' as const,
    consentAcknowledgment: true as const,
  };

  it('should import leads with valid input', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      leads: [
        { firstName: 'John', email: 'john@example.com' },
        { firstName: 'Jane', email: 'jane@example.com' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(2);
      expect(result.data.skipped).toBe(0);
      expect(result.data.errors).toHaveLength(0);
    }
  });

  it('does not issue an empty IN-list query when dedup leads have no email (BOR-70)', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput, // deduplicateBy: 'email'
      leads: [{ firstName: 'NoEmail1' }, { firstName: 'NoEmail2' }],
    });

    expect(result.success).toBe(true);
    // With no emails to dedup on, findExistingLeads must short-circuit and never
    // run `inArray(lead.email, [])` — Drizzle emits invalid SQL for an empty IN
    // list, which crashed imports in production (BOR-70). The guard is the
    // `conditions.length === 0` early-return; this locks it in.
    expect(mockDb.query.lead.findMany).not.toHaveBeenCalled();
    if (result.success) {
      expect(result.data.imported).toBe(2);
    }
  });

  it('should return VALIDATION_ERROR for empty leads array', async () => {
    await expectResult(
      importLeads(mockDb as never, {
        ...baseInput,
        leads: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      importLeads(mockDb as never, {
        organizationId: '',
        leads: [{ firstName: 'John' }],
        deduplicateBy: 'email',
        onDuplicate: 'skip',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should skip duplicate leads when deduplicateBy is email and onDuplicate is skip', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        id: 'existing_1',
        email: 'john@example.com',
        organizationId: 'org_123',
        firstName: 'John',
      },
    ]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      leads: [
        { firstName: 'John', email: 'john@example.com' },
        { firstName: 'Jane', email: 'jane@example.com' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.skipped).toBe(1);
    }
  });

  it('should update duplicates when onDuplicate is update', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        id: 'existing_1',
        email: 'john@example.com',
        organizationId: 'org_123',
        firstName: 'Old John',
        tags: ['existing-tag'],
      },
    ]);
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      onDuplicate: 'update',
      leads: [
        { firstName: 'New John', email: 'john@example.com', tags: ['new-tag'] },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.updated).toBe(1);
      expect(result.data.imported).toBe(0);
    }
  });

  it('should create new leads for duplicates when onDuplicate is create_new', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([
      {
        id: 'existing_1',
        email: 'john@example.com',
        organizationId: 'org_123',
        firstName: 'John',
      },
    ]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      onDuplicate: 'create_new',
      leads: [{ firstName: 'John', email: 'john@example.com' }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.skipped).toBe(0);
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('should skip dedup check when deduplicateBy is none', async () => {
    const result = await importLeads(mockDb as never, {
      ...baseInput,
      deduplicateBy: 'none',
      leads: [
        { firstName: 'John', email: 'john@example.com' },
        { firstName: 'John', email: 'john@example.com' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(2);
    }
    // Should not query for existing leads
    expect(mockDb.query.lead.findMany).not.toHaveBeenCalled();
  });

  it('should add default tags to all imported leads', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      defaultTags: ['imported', 'batch-1'],
      leads: [{ firstName: 'John', email: 'john@example.com' }],
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          tags: expect.arrayContaining(['imported', 'batch-1']),
        }),
      ])
    );
  });

  it('should report errors for rows without name or email', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      leads: [
        { firstName: 'John', email: 'john@example.com' },
        { notes: 'Just a note, no name or email' } as never,
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(2);
    }
  });

  it('should report errors for invalid email formats', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      leads: [
        { firstName: 'John', email: 'not-an-email' },
        { firstName: 'Jane', email: 'jane@example.com' },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.imported).toBe(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0].row).toBe(1);
    }
  });

  it('should return VALIDATION_ERROR when consentAcknowledgment is false', async () => {
    await expectResult(
      importLeads(mockDb as never, {
        ...baseInput,
        consentAcknowledgment: false as never,
        leads: [{ firstName: 'John', email: 'john@example.com' }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR when consentAcknowledgment is missing', async () => {
    const inputWithoutConsent = {
      organizationId: 'org_123',
      deduplicateBy: 'email' as const,
      onDuplicate: 'skip' as const,
      leads: [{ firstName: 'John', email: 'john@example.com' }],
    };

    await expectResult(
      importLeads(mockDb as never, inputWithoutConsent as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should apply default consent settings to imported leads', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      defaultConsentEmail: true,
      defaultConsentSms: true,
      defaultConsentVoice: false,
      leads: [{ firstName: 'John', email: 'john@example.com' }],
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          consentEmail: true,
          consentSms: true,
          consentVoice: false,
          consentSource: 'csv_import',
        }),
      ])
    );
  });

  it('should allow per-row consent to override defaults', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      defaultConsentEmail: false,
      leads: [
        {
          firstName: 'John',
          email: 'john@example.com',
          consentEmail: true,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          consentEmail: true,
        }),
      ])
    );
  });

  it('should use firstName from email when firstName is missing', async () => {
    mockDb.query.lead.findMany.mockResolvedValueOnce([]);

    const result = await importLeads(mockDb as never, {
      ...baseInput,
      leads: [{ email: 'john@example.com' }],
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          firstName: 'john@example.com',
        }),
      ])
    );
  });
});
