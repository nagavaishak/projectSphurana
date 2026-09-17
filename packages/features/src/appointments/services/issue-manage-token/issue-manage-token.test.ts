import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { hashManageToken } from '../../shared/manage-token.js';
import { issueManageToken } from './issue-manage-token.service.js';

describe('issueManageToken', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const input = {
    organizationId: 'org-1',
    appointmentId: 'appt-1',
    appointmentEnd: new Date('2026-04-01T10:30:00Z'),
  };

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('returns the RAW token and stores only its hash', async () => {
    const result = await issueManageToken(mockDb as never, input);

    expect(result.success).toBe(true);
    if (!result.success) return;

    const raw = result.data.token;
    expect(raw).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // The value handed to the DB must be the hash, never the raw token.
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        appointmentId: 'appt-1',
        tokenHash: hashManageToken(raw),
      })
    );

    const stored = mockDb.values.mock.calls[0]?.[0] as { tokenHash: string };
    expect(stored.tokenHash).not.toBe(raw);
  });

  it('replaces any existing token so old emails keep working against ONE capability', async () => {
    // Re-issuing must not accumulate live tokens for the same appointment.
    await issueManageToken(mockDb as never, input);

    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('issues a different token every time', async () => {
    const a = await issueManageToken(mockDb as never, input);
    const b = await issueManageToken(mockDb as never, input);

    expect(a.success && b.success).toBe(true);
    if (a.success && b.success) {
      expect(a.data.token).not.toBe(b.data.token);
    }
  });

  it('expires AFTER the appointment ends, not at it', async () => {
    const result = await issueManageToken(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expiresAt.getTime()).toBeGreaterThan(
        input.appointmentEnd.getTime()
      );
    }
  });

  it('returns VALIDATION_ERROR when the appointment is missing', async () => {
    const result = await issueManageToken(mockDb as never, {
      ...input,
      appointmentId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the insert fails', async () => {
    mockDb.insert.mockImplementationOnce(() => {
      throw new Error('DB down');
    });

    const result = await issueManageToken(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
