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
import { setShiftOverride } from './set-shift-override.service.js';

describe('setShiftOverride', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Default: the practitioner belongs to the caller's org so the ownership
    // check passes. Overridden in the NOT_FOUND case below.
    mockDb.query.practitioner.findFirst.mockResolvedValue({ id: 'prac_1' });
  });

  it('replaces override rows for a date', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 's_1', date: '2026-07-10', startMinutes: 600, endMinutes: 840 },
    ]);

    const data = await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
        isOff: false,
        intervals: [{ startMinutes: 600, endMinutes: 840 }],
      })
    ).toSucceedWith();

    expect(data).toHaveLength(1);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('writes a single isOff row for a day off', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 's_off', date: '2026-07-10', isOff: true },
    ]);

    const data = await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
        isOff: true,
      })
    ).toSucceedWith();

    expect(data[0].isOff).toBe(true);
  });

  it('returns VALIDATION_ERROR when isOff with intervals', async () => {
    await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
        isOff: true,
        intervals: [{ startMinutes: 600, endMinutes: 840 }],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR when not off and no intervals', async () => {
    await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
        isOff: false,
        intervals: [],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for a malformed date', async () => {
    await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '10/07/2026',
        isOff: true,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns NOT_FOUND when the practitioner is not in the org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(undefined);

    await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_other',
        date: '2026-07-10',
        isOff: true,
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      setShiftOverride(mockDb as never, {
        organizationId: 'org_1',
        practitionerId: 'prac_1',
        date: '2026-07-10',
        isOff: true,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
