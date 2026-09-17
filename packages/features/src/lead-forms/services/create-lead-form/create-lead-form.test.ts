import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as syncLeadFormToMetaModule from '../sync-lead-form-to-meta/sync-lead-form-to-meta.service.js';
import { createLeadForm } from './create-lead-form.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate:false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file. The spy is installed at run
// time (load-order independent), and `mockRestore` keeps it from leaking out.
const mocks = {
  syncLeadFormToMeta: undefined as unknown as MockInstance,
};

const mockDb = createMockDatabase();

const validInput = {
  organizationId: 'org-1',
  name: 'Contact Form',
  questions: [{ type: 'EMAIL' as const }],
  privacyPolicyUrl: 'https://example.com/privacy',
};

const mockForm = {
  id: 'form-1',
  organizationId: 'org-1',
  name: 'Contact Form',
  questions: [{ type: 'EMAIL' }],
  privacyPolicyUrl: 'https://example.com/privacy',
  status: 'draft',
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('createLeadForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mocks.syncLeadFormToMeta = vi
      .spyOn(syncLeadFormToMetaModule, 'syncLeadFormToMeta')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    mocks.syncLeadFormToMeta.mockRestore();
  });

  it('should create a lead form with valid input', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockForm]);

    const result = await createLeadForm(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Contact Form');
      expect(result.data.status).toBe('draft');
    }
  });

  it('should return VALIDATION_ERROR for missing name', async () => {
    await expectResult(
      createLeadForm(mockDb as never, {
        ...validInput,
        name: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing questions', async () => {
    await expectResult(
      createLeadForm(mockDb as never, {
        ...validInput,
        questions: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid privacy policy URL', async () => {
    await expectResult(
      createLeadForm(mockDb as never, {
        ...validInput,
        privacyPolicyUrl: 'not-a-url',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('falls back to the org website when no privacy URL is supplied', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      privacyPolicyUrl: null,
      websiteUrl: 'https://clinic.example',
      facebookPageUrl: null,
    });
    mockDb.returning.mockResolvedValueOnce([mockForm]);

    const { privacyPolicyUrl: _omit, ...withoutPrivacy } = validInput;
    const result = await createLeadForm(mockDb as never, withoutPrivacy);

    expect(result.success).toBe(true);
    // The resolved website is what gets written to the form.
    const insertValues = mockDb.values.mock.calls[0]?.[0] as {
      privacyPolicyUrl?: string;
    };
    expect(insertValues.privacyPolicyUrl).toBe('https://clinic.example');
  });

  it('falls back to the connected Facebook Page when the org has no website', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      privacyPolicyUrl: null,
      websiteUrl: null,
      facebookPageUrl: null,
    });
    // The connected-page lookup (select…innerJoin…where) resolves to one page.
    mockDb.where.mockResolvedValueOnce([
      { pageId: '123456', pageUsername: 'clinicpage', platform: 'facebook' },
    ]);
    mockDb.returning.mockResolvedValueOnce([mockForm]);

    const { privacyPolicyUrl: _omit, ...withoutPrivacy } = validInput;
    const result = await createLeadForm(mockDb as never, withoutPrivacy);

    expect(result.success).toBe(true);
    const insertValues = mockDb.values.mock.calls[0]?.[0] as {
      privacyPolicyUrl?: string;
    };
    expect(insertValues.privacyPolicyUrl).toBe(
      'https://facebook.com/clinicpage'
    );
  });

  it('errors only when there is no policy, website, Facebook Page, or connected page', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      privacyPolicyUrl: null,
      websiteUrl: null,
      facebookPageUrl: null,
    });
    // No connected pages either.
    mockDb.where.mockResolvedValueOnce([]);

    const { privacyPolicyUrl: _omit, ...withoutPrivacy } = validInput;
    await expectResult(
      createLeadForm(mockDb as never, withoutPrivacy)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS for duplicate name', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(mockForm);

    await expectResult(
      createLeadForm(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('should sync to Meta when syncToMeta is true', async () => {
    const syncedForm = { ...mockForm, status: 'synced', metaFormId: 'meta-1' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([mockForm]);
    mocks.syncLeadFormToMeta.mockResolvedValueOnce({
      success: true,
      data: syncedForm,
    });

    const result = await createLeadForm(mockDb as never, {
      ...validInput,
      syncToMeta: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('synced');
    }
    expect(mocks.syncLeadFormToMeta).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ leadFormId: 'form-1' })
    );
  });

  it('surfaces the persisted error row (not the stale draft) when Meta sync fails', async () => {
    // The sync service persists status:'error' + syncError on the row before
    // failing; the service must re-read and return THAT, not the pre-sync draft.
    const erroredForm = {
      ...mockForm,
      status: 'error',
      syncError: 'Meta Ads integration not configured or inactive',
    };
    // 1st findFirst: duplicate-name check (none). 2nd findFirst: re-read after
    // the failed sync returns the authoritative errored row.
    mockDb.query.leadForm.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(erroredForm);
    mockDb.returning.mockResolvedValueOnce([mockForm]);
    mocks.syncLeadFormToMeta.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Sync failed' },
    });

    const result = await createLeadForm(mockDb as never, {
      ...validInput,
      syncToMeta: true,
    });

    // Still a created form (ok), but the caller now sees the failure, not a
    // clean draft that masks it.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('error');
      expect(result.data.syncError).toBe(
        'Meta Ads integration not configured or inactive'
      );
    }
  });

  it('returns VALIDATION_ERROR for whatsapp channel without a number', async () => {
    await expectResult(
      createLeadForm(mockDb as never, {
        ...validInput,
        followUpChannel: 'whatsapp',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    // Validation fails before any DB work.
    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('allows whatsapp channel when a number is provided', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...mockForm,
        followUpChannel: 'whatsapp',
        whatsappNumber: '+15551234567',
      },
    ]);

    const result = await createLeadForm(mockDb as never, {
      ...validInput,
      followUpChannel: 'whatsapp',
      whatsappNumber: '+15551234567',
    });

    expect(result.success).toBe(true);
  });
});
