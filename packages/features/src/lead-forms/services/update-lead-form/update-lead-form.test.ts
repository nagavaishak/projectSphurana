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
import { updateLeadForm } from './update-lead-form.service.js';

// A restored `vi.spyOn`, NOT `vi.mock`. Under `isolate:false` the worker shares
// one module graph, so a hoisted `vi.mock` of an internal module silently MISSES
// whenever some earlier file already imported the real module, and its bare
// factory poisons that module for every later file. The spy is installed at run
// time (load-order independent), and `mockRestore` keeps it from leaking out.
const mocks = {
  syncLeadFormToMeta: undefined as unknown as MockInstance,
};

const mockDb = createMockDatabase();

const existingForm = {
  id: 'form-1',
  organizationId: 'org-1',
  name: 'Contact Form',
  questions: [{ type: 'EMAIL' }],
  status: 'synced',
  metaFormId: 'meta-123',
};

describe('updateLeadForm', () => {
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

  it('should update lead form with valid input', async () => {
    const updatedForm = { ...existingForm, name: 'Updated Form' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null); // no duplicate
    mockDb.returning.mockResolvedValueOnce([updatedForm]);

    const result = await updateLeadForm(mockDb as never, {
      id: 'form-1',
      name: 'Updated Form',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Updated Form');
    }
  });

  it('should return NOT_FOUND when form does not exist', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateLeadForm(mockDb as never, { id: 'nonexistent', name: 'New' })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    await expectResult(
      updateLeadForm(mockDb as never, { id: '', name: 'Test' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
  });

  it('should return ALREADY_EXISTS for duplicate name', async () => {
    mockDb.query.leadForm.findFirst
      .mockResolvedValueOnce(existingForm)
      .mockResolvedValueOnce({ id: 'form-2', name: 'Taken Name' });

    await expectResult(
      updateLeadForm(mockDb as never, { id: 'form-1', name: 'Taken Name' })
    ).toFailWithCode(ErrorCodes.ALREADY_EXISTS);
  });

  it('should mark as draft when content changed on synced form', async () => {
    const draftForm = { ...existingForm, status: 'draft', name: 'New Name' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    mockDb.returning.mockResolvedValueOnce([draftForm]);

    const result = await updateLeadForm(mockDb as never, {
      id: 'form-1',
      name: 'New Name',
    });

    expect(result.success).toBe(true);
  });

  it('should sync to Meta when syncToMeta is true', async () => {
    const syncedForm = { ...existingForm, status: 'synced' };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.returning.mockResolvedValueOnce([existingForm]);
    mocks.syncLeadFormToMeta.mockResolvedValueOnce({
      success: true,
      data: syncedForm,
    });

    const result = await updateLeadForm(mockDb as never, {
      id: 'form-1',
      syncToMeta: true,
    });

    expect(result.success).toBe(true);
    expect(mocks.syncLeadFormToMeta).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when setting whatsapp channel without a number', async () => {
    await expectResult(
      updateLeadForm(mockDb as never, {
        id: 'form-1',
        followUpChannel: 'whatsapp',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    // Validation fails before any DB work.
    expect(mockDb.query.leadForm.findFirst).not.toHaveBeenCalled();
  });

  it('allows setting whatsapp channel when a number is provided', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.returning.mockResolvedValueOnce([
      {
        ...existingForm,
        followUpChannel: 'whatsapp',
        whatsappNumber: '+15551234567',
      },
    ]);

    const result = await updateLeadForm(mockDb as never, {
      id: 'form-1',
      followUpChannel: 'whatsapp',
      whatsappNumber: '+15551234567',
    });

    expect(result.success).toBe(true);
  });

  it('should still return updated form when Meta sync fails', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(existingForm);
    mockDb.returning.mockResolvedValueOnce([existingForm]);
    mocks.syncLeadFormToMeta.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Sync failed' },
    });
    // On sync failure the service re-reads the row; the sync service has
    // persisted the error state there.
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      ...existingForm,
      status: 'error',
      syncError: 'Sync failed',
    });

    const result = await updateLeadForm(mockDb as never, {
      id: 'form-1',
      syncToMeta: true,
    });

    expect(result.success).toBe(true);
  });

  it('returns the persisted error row (not the stale draft) when Meta sync fails', async () => {
    const preSyncDraft = { ...existingForm, status: 'draft', syncError: null };
    const persistedError = {
      ...existingForm,
      status: 'error',
      syncError: 'Meta rejected the form',
    };
    // 1st findFirst: load existing form. 2nd: re-read after sync failure.
    mockDb.query.leadForm.findFirst
      .mockResolvedValueOnce(existingForm)
      .mockResolvedValueOnce(persistedError);
    mockDb.returning.mockResolvedValueOnce([preSyncDraft]);
    mocks.syncLeadFormToMeta.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Sync failed' },
    });

    const result = await updateLeadForm(mockDb as never, {
      id: 'form-1',
      syncToMeta: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // Must reflect the real persisted error state, not the stale draft.
      expect(result.data.status).toBe('error');
      expect(result.data.syncError).toBe('Meta rejected the form');
    }
  });

  it('returns VALIDATION_ERROR when clearing the number on a whatsapp form (partial update)', async () => {
    // Existing form is already a whatsapp form WITH a number. A partial update
    // that blanks the number and does NOT resend followUpChannel must be
    // rejected against the effective merged state, before any write.
    const whatsappForm = {
      ...existingForm,
      followUpChannel: 'whatsapp',
      whatsappNumber: '+15551234567',
    };
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(whatsappForm);

    await expectResult(
      updateLeadForm(mockDb as never, {
        id: 'form-1',
        whatsappNumber: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    // The invalid state is caught before writing the blank number.
    expect(mockDb.returning).not.toHaveBeenCalled();
  });
});
