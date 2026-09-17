import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../shared/index.js';
import { hashManageToken } from './manage-token.js';
import { resolveManageToken } from './resolve-manage-token.js';

/**
 * The trust boundary of the whole self-serve flow. Everything downstream
 * assumes a caller who gets past this function is entitled to act on the
 * appointment it returns, so these are the tests that matter most.
 */
describe('resolveManageToken', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const RAW_TOKEN = 'raw-token-abc';
  const org = { id: 'org-1', slug: 'glow', deletedAt: null };
  const appt = {
    id: 'appt-1',
    organizationId: 'org-1',
    status: 'booked',
    startDate: new Date('2026-04-01T10:00:00Z'),
    endDate: new Date('2026-04-01T10:30:00Z'),
  };

  const tokenRow = (overrides?: {
    expiresAt?: Date;
    appointmentId?: string;
  }) => ({
    id: 'tok-1',
    organizationId: 'org-1',
    appointmentId: overrides?.appointmentId ?? 'appt-1',
    tokenHash: hashManageToken(RAW_TOKEN),
    expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
  });

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('resolves a live token to its appointment', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      tokenRow()
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(appt);

    const result = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: RAW_TOKEN,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.appointment.id).toBe('appt-1');
      expect(result.data.org.id).toBe('org-1');
    }
  });

  it('looks the token up BY HASH — the raw token never reaches the database', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      tokenRow()
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(appt);

    await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: RAW_TOKEN,
    });

    // Whatever we passed to the query, the plaintext token must not be in it —
    // otherwise it lands in query logs. Drizzle's SQL objects are cyclic, so
    // walk them with a seen-set rather than serialising.
    const containsRawToken = (
      value: unknown,
      seen = new Set<unknown>()
    ): boolean => {
      if (typeof value === 'string') return value.includes(RAW_TOKEN);
      if (value === null || typeof value !== 'object') return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return Object.values(value as Record<string, unknown>).some((v) =>
        containsRawToken(v, seen)
      );
    };

    const args = mockDb.query.appointmentManageToken.findFirst.mock.calls[0];
    expect(containsRawToken(args)).toBe(false);

    // ...and the HASH is what we actually searched by.
    const containsHash = (
      value: unknown,
      seen = new Set<unknown>()
    ): boolean => {
      if (typeof value === 'string')
        return value.includes(hashManageToken(RAW_TOKEN));
      if (value === null || typeof value !== 'object') return false;
      if (seen.has(value)) return false;
      seen.add(value);
      return Object.values(value as Record<string, unknown>).some((v) =>
        containsHash(v, seen)
      );
    };
    expect(containsHash(args)).toBe(true);
  });

  it('rejects an EXPIRED token', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      tokenRow({ expiresAt: new Date(Date.now() - 1000) })
    );

    const result = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: RAW_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('rejects an UNKNOWN token', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: 'not-a-real-token',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('rejects an unknown ORG slug without ever touching the token table', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);

    const result = await resolveManageToken(mockDb as never, {
      organizationSlug: 'does-not-exist',
      token: RAW_TOKEN,
    });

    expect(result.success).toBe(false);
    // We must bail at the slug: looking up the token first would mean probing
    // it with NO org context set, which is the exact hole org_isolation exists
    // to close.
    expect(
      mockDb.query.appointmentManageToken.findFirst
    ).not.toHaveBeenCalled();
  });

  it('rejects when the token resolves but the appointment is gone', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      tokenRow()
    );
    mockDb.query.appointment.findFirst.mockResolvedValueOnce(undefined);

    const result = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: RAW_TOKEN,
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('gives the SAME error for expired, unknown, and wrong-org — no oracle', async () => {
    const messages: string[] = [];

    // Unknown token.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      undefined
    );
    const unknown = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: 'x',
    });
    if (!unknown.success) messages.push(unknown.error.message);

    // Expired token.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.appointmentManageToken.findFirst.mockResolvedValueOnce(
      tokenRow({ expiresAt: new Date(Date.now() - 1000) })
    );
    const expired = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: RAW_TOKEN,
    });
    if (!expired.success) messages.push(expired.error.message);

    // Unknown org.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);
    const wrongOrg = await resolveManageToken(mockDb as never, {
      organizationSlug: 'nope',
      token: RAW_TOKEN,
    });
    if (!wrongOrg.success) messages.push(wrongOrg.error.message);

    // An attacker must not be able to tell these three apart.
    expect(messages).toHaveLength(3);
    expect(new Set(messages).size).toBe(1);
  });

  it('rejects an empty token without querying anything', async () => {
    const result = await resolveManageToken(mockDb as never, {
      organizationSlug: 'glow',
      token: '',
    });

    expect(result.success).toBe(false);
    expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
  });
});
