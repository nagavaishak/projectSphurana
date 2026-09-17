import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ensureLeadFormSynced } from './ensure-lead-form-synced.service.js';

const mockDb = {
  query: {
    leadForm: { findFirst: vi.fn() },
    organizationService: { findMany: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

const metaService = { getLeadGenForm: vi.fn() };

const baseInput = {
  organizationId: 'org-1',
  metaFormId: 'F1',
  metaPageInternalId: 'page-int-1',
  metaService,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.insert.mockReturnThis();
  mockDb.values.mockResolvedValue(undefined);
  mockDb.update.mockReturnThis();
  mockDb.set.mockReturnThis();
  mockDb.where.mockResolvedValue(undefined);
});

describe('ensureLeadFormSynced', () => {
  it('does nothing when the form is already linked to a service', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      id: 'lf-1',
      name: 'x',
      organizationServiceId: 'svc-existing',
      questions: [],
    });

    await ensureLeadFormSynced(mockDb as never, baseInput);

    expect(metaService.getLeadGenForm).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('syncs a Meta-native form and links the suggested service', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    metaService.getLeadGenForm.mockResolvedValueOnce({
      id: 'F1',
      name: 'CoolSculpting Intro Offer',
      status: 'ACTIVE',
      questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }],
      privacyPolicyUrl: 'https://example.com/privacy',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-cool', name: 'CoolSculpting' },
      { id: 'svc-botox', name: 'Botox' },
    ]);

    await ensureLeadFormSynced(mockDb as never, baseInput);

    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        metaFormId: 'F1',
        status: 'synced',
        metaPageId: 'page-int-1',
        organizationServiceId: 'svc-cool',
        serviceLinkSource: 'suggested',
      })
    );
  });

  it('syncs the form without a service link when no service matches', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    metaService.getLeadGenForm.mockResolvedValueOnce({
      id: 'F1',
      name: 'What is your main wellness goal?',
      status: 'ACTIVE',
      questions: [],
      privacyPolicyUrl: 'https://example.com/privacy',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-cool', name: 'CoolSculpting' },
    ]);

    await ensureLeadFormSynced(mockDb as never, baseInput);

    expect(mockDb.insert).toHaveBeenCalled();
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted).not.toHaveProperty('organizationServiceId');
    expect(inserted).not.toHaveProperty('serviceLinkSource');
  });

  it('does not insert when the Meta form fetch fails', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce(null);
    metaService.getLeadGenForm.mockRejectedValueOnce(new Error('Meta 400'));

    await ensureLeadFormSynced(mockDb as never, baseInput);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('backfills a suggested service on an existing form without refetching Meta', async () => {
    mockDb.query.leadForm.findFirst.mockResolvedValueOnce({
      id: 'lf-existing',
      name: 'CoolSculpting — New Client Form',
      organizationServiceId: null,
      questions: [],
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-cool', name: 'CoolSculpting' },
    ]);

    await ensureLeadFormSynced(mockDb as never, baseInput);

    expect(metaService.getLeadGenForm).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationServiceId: 'svc-cool',
        serviceLinkSource: 'suggested',
      })
    );
  });

  it('never throws (DB error is swallowed)', async () => {
    mockDb.query.leadForm.findFirst.mockRejectedValueOnce(new Error('DB down'));

    await expect(
      ensureLeadFormSynced(mockDb as never, baseInput)
    ).resolves.toBeUndefined();
  });
});
