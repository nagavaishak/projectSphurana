import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listGiftCards } from './list-gift-cards.service.js';

describe('listGiftCards', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123' };

  it('lists gift cards with total', async () => {
    // Both queries are core selects now: the rows terminate at .offset(), the
    // count at .where(). The relational builder is deliberately not used —
    // it aliases its root table and breaks the correlated location subquery.
    mockDb.offset.mockResolvedValueOnce([
      { id: 'gc_1', code: 'GC-AAAA-BBBB-CCCC', balanceCents: 5000 },
    ]);
    // `where` serves BOTH queries, in order: the rows chain keeps going
    // (orderBy/limit/offset), the count chain terminates.
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([{ total: 1 }]);

    await expectResult(
      listGiftCards(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(1);
      expect(data.total).toBe(1);
    });
  });

  it('returns empty list when no cards exist', async () => {
    mockDb.offset.mockResolvedValueOnce([]);
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([{ total: 0 }]);

    await expectResult(
      listGiftCards(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.items).toHaveLength(0);
    });
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listGiftCards(mockDb as never, {
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('never uses the relational builder — it breaks the location subquery', async () => {
    // The location filter adds a correlated `exists(...)` that references the
    // outer gift_card row. `db.query.giftCard.findMany` aliases its root table,
    // so that reference resolved to a table not in the FROM clause and Postgres
    // answered `invalid reference to FROM-clause entry for table "gift_card"` —
    // a 500 on the gift-cards page for every org with an active location.
    //
    // A mock cannot reproduce the SQL, so pin the shape that caused it.
    mockDb.offset.mockResolvedValueOnce([]);
    // Three `where` calls with a locationId: the exists(...) subquery is built
    // first, then the rows chain, then the count.
    mockDb.where
      .mockReturnValueOnce(mockDb)
      .mockReturnValueOnce(mockDb)
      .mockResolvedValueOnce([{ total: 0 }]);

    await expectResult(
      listGiftCards(mockDb as never, {
        ...validInput,
        locationId: 'loc_123',
      })
    ).toSucceedWith(() => undefined);

    expect(mockDb.query.giftCard.findMany).not.toHaveBeenCalled();
    expect(mockDb.select).toHaveBeenCalled();
  });
});
