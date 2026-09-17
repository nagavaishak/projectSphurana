import { createMockDatabase } from '@borradh-workspace/testing';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
// Spy the SOURCE module, not a barrel: barrel re-exports are live getters under
// Vite SSR and cannot be redefined, and a restored spy can't leak onto the
// shared module graph (`isolate: false`).
import * as createPractitionerModule from '../create-practitioner/create-practitioner.service.js';
import { ensureDefaultPractitioner } from './ensure-default-practitioner.service.js';

describe('ensureDefaultPractitioner', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;
  let createPractitioner: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    createPractitioner = vi
      .spyOn(createPractitionerModule, 'createPractitioner')
      .mockResolvedValue({
        success: true,
        data: { id: 'prac-new', organizationId: 'org-1' },
      } as never);
  });

  afterEach(() => createPractitioner.mockRestore());

  it('is a no-op when the org already has an active practitioner', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac-existing',
      organizationId: 'org-1',
    });

    const result = await ensureDefaultPractitioner(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(false);
      expect(result.data.practitioner.id).toBe('prac-existing');
    }
    expect(createPractitioner).not.toHaveBeenCalled();
  });

  it('creates a practitioner from the owner when the org has none', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'owner',
      user: { id: 'user-1', name: 'Pavit Gogia', email: 'pavit@example.com' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Pavit Test',
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'prac-new', organizationId: 'org-1', userId: 'user-1' },
    ]);

    const result = await ensureDefaultPractitioner(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.created).toBe(true);
    expect(createPractitioner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org-1',
        name: 'Pavit Gogia',
        email: 'pavit@example.com',
      })
    );
    // The owner's login is linked to their column on the calendar.
    expect(mockDb.set).toHaveBeenCalledWith({ userId: 'user-1' });
  });

  it('falls back to the org name when the owner has no name set', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);
    mockDb.query.member.findFirst.mockResolvedValueOnce({
      organizationId: 'org-1',
      role: 'owner',
      user: { id: 'user-1', name: '  ', email: 'pavit@example.com' },
    });
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      name: 'Pavit Test',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'prac-new' }]);

    await ensureDefaultPractitioner(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(createPractitioner).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'Pavit Test' })
    );
  });

  it('returns NOT_FOUND when the org has no member to derive one from', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null);
    mockDb.query.member.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const result = await ensureDefaultPractitioner(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(createPractitioner).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a missing organization id', async () => {
    const result = await ensureDefaultPractitioner(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
