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
import * as checkMemberAccessModule from '../../../organizations/services/check-member-access/check-member-access.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as listAppointmentsModule from '../list-appointments/list-appointments.service.js';
import { listAppointmentsForMember } from './list-appointments-for-member.service.js';

// `vi.spyOn`, NOT `vi.mock`: under `isolate: false` every file in a worker
// shares one module graph, so a hoisted factory mock leaks into later files and
// misses whenever an earlier file already imported the real module.
let checkMemberAccess: MockInstance;
let listAppointments: MockInstance;

const emptyPage = {
  success: true,
  data: { items: [], total: 0, limit: 100, offset: 0 },
};

describe('listAppointmentsForMember', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const input = { organizationId: 'org-1', userId: 'user-1' };

  const memberIs = (role: string | null) => {
    checkMemberAccess.mockResolvedValueOnce({
      success: true,
      data: { isMember: role !== null, role },
    } as never);
  };

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
    checkMemberAccess = vi
      .spyOn(checkMemberAccessModule, 'checkMemberAccess')
      .mockReturnValue(undefined as never);
    listAppointments = vi
      .spyOn(listAppointmentsModule, 'listAppointments')
      .mockResolvedValue(emptyPage as never);
  });

  afterEach(() => {
    checkMemberAccess.mockRestore();
    listAppointments.mockRestore();
  });

  it('lets an owner see the whole organization calendar', async () => {
    memberIs('owner');

    const result = await listAppointmentsForMember(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({
        organizationId: 'org-1',
        scopeToUserId: undefined,
      })
    );
  });

  it('lets an admin see the whole organization calendar', async () => {
    memberIs('admin');

    await listAppointmentsForMember(mockDb as never, input);

    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ scopeToUserId: undefined })
    );
  });

  it('scopes a plain member to their own appointments', async () => {
    memberIs('member');

    await listAppointmentsForMember(mockDb as never, input);

    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ scopeToUserId: 'user-1' })
    );
  });

  it('scopes a non-member (no role) to their own appointments', async () => {
    memberIs(null);

    await listAppointmentsForMember(mockDb as never, input);

    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ scopeToUserId: 'user-1' })
    );
  });

  it('scopes to own appointments when the role lookup fails', async () => {
    checkMemberAccess.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'boom' },
    } as never);

    await listAppointmentsForMember(mockDb as never, input);

    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ scopeToUserId: 'user-1' })
    );
  });

  it('defaults limit to 100 and offset to 0', async () => {
    memberIs('owner');

    await listAppointmentsForMember(mockDb as never, input);

    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ limit: 100, offset: 0 })
    );
  });

  it('forwards caller-supplied paging and filters', async () => {
    memberIs('owner');

    await listAppointmentsForMember(mockDb as never, {
      ...input,
      limit: 25,
      offset: 50,
      status: 'booked',
    });

    expect(listAppointments).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ limit: 25, offset: 50, status: 'booked' })
    );
  });

  it('returns the page from listAppointments', async () => {
    memberIs('owner');
    listAppointments.mockResolvedValueOnce({
      success: true,
      data: { items: [{ id: 'appt-1' }], total: 1, limit: 100, offset: 0 },
    } as never);

    const result = await listAppointmentsForMember(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(1);
    }
  });

  it('returns VALIDATION_ERROR when userId is missing', async () => {
    const result = await listAppointmentsForMember(
      mockDb as never,
      {
        organizationId: 'org-1',
      } as never
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(checkMemberAccess).not.toHaveBeenCalled();
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when organizationId is empty', async () => {
    const result = await listAppointmentsForMember(mockDb as never, {
      organizationId: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it('propagates a failure from listAppointments', async () => {
    memberIs('owner');
    listAppointments.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'db down' },
    } as never);

    const result = await listAppointmentsForMember(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(result.error.message).toBe('db down');
    }
  });
});
