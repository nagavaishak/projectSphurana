import {
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getLeadStageCounts } from './get-lead-stage-counts.service.js';

describe('getLeadStageCounts', () => {
  const mocks = {
    mockSelect: vi.fn(),
    mockFrom: vi.fn(),
    mockWhere: vi.fn(),
    mockGroupBy: vi.fn(),
  };

  const mockDb = { select: mocks.mockSelect } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockSelect.mockReturnValue({ from: mocks.mockFrom });
    mocks.mockFrom.mockReturnValue({ where: mocks.mockWhere });
    mocks.mockWhere.mockReturnValue({ groupBy: mocks.mockGroupBy });
  });

  const validInput = { organizationId: 'org_123' };

  it('returns per-stage counts and per-tab counts', async () => {
    mocks.mockGroupBy.mockResolvedValueOnce([
      { status: 'new', count: 10 },
      { status: 'contacted', count: 5 },
      { status: 'qualified', count: 4 },
      { status: 'booked', count: 3 },
      { status: 'lost', count: 2 },
    ]);

    const result = await getLeadStageCounts(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stages).toEqual({
        new: 10,
        contacted: 5,
        qualified: 4,
        booked: 3,
        lost: 2,
      });
      // `all` includes lost; the Contacted tab folds in qualified (5 + 4).
      expect(result.data.tabs).toEqual({
        all: 24,
        leads: 10,
        contacted: 9,
        booked: 3,
      });
    }
  });

  it('zero-fills stages with no rows', async () => {
    mocks.mockGroupBy.mockResolvedValueOnce([{ status: 'new', count: 4 }]);

    const result = await getLeadStageCounts(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stages).toEqual({
        new: 4,
        contacted: 0,
        qualified: 0,
        booked: 0,
        lost: 0,
      });
      expect(result.data.tabs.all).toBe(4);
    }
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      getLeadStageCounts(mockDb, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  // ── ENG-816: the badges must be scoped to the same branch as the rows ─────
  //
  // This service filtered by ORGANISATION alone while `listLeads` filtered by
  // branch, so the tab badges counted the whole org and the table beneath them
  // counted one site: "All 36" above 24 rows on the seeded three-branch demo,
  // with nothing on screen to explain the gap. The service's own doc claims
  // "the counts and the list are the same expression, so a badge can never
  // disagree with the rows behind it" — true of the derived STAGE, false of the
  // BRANCH until the predicate was shared (`leads/shared/at-branch.ts`).
  //
  // `leadAtBranch` is three-armed and its third arm is an `exists()` subquery,
  // so supplying a branch builds a SECOND query off `db.select` — which is what
  // separates "branch predicate applied" from "not applied" here.

  it('scopes the counts to the active branch when one is supplied', async () => {
    mocks.mockGroupBy.mockResolvedValueOnce([{ status: 'new', count: 7 }]);

    const result = await getLeadStageCounts(mockDb, {
      ...validInput,
      locationId: 'loc_cork',
    });

    expect(result.success).toBe(true);
    // Outer query + the `exists()` subquery from the branch predicate.
    expect(mocks.mockWhere).toHaveBeenCalledTimes(2);
  });

  it('stays org-wide when no branch is supplied', async () => {
    mocks.mockGroupBy.mockResolvedValueOnce([{ status: 'new', count: 7 }]);

    const result = await getLeadStageCounts(mockDb, validInput);

    expect(result.success).toBe(true);
    // No branch predicate means no subquery — one `where` only.
    expect(mocks.mockWhere).toHaveBeenCalledTimes(1);
  });
});
