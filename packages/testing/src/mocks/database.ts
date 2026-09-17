import { vi } from 'vitest';

/**
 * Mock query builder that simulates Drizzle ORM chainable methods
 */
export interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  groupBy: ReturnType<typeof vi.fn>;
  having: ReturnType<typeof vi.fn>;
  for: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

/**
 * Mock table interface for Drizzle relational queries
 */
export interface MockQueryTable {
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
}

/**
 * Mock database interface that matches Drizzle ORM patterns
 */
export interface MockDatabase {
  // Insert operations
  insert: ReturnType<typeof vi.fn>;
  values: ReturnType<typeof vi.fn>;
  returning: ReturnType<typeof vi.fn>;
  onConflictDoNothing: ReturnType<typeof vi.fn>;
  onConflictDoUpdate: ReturnType<typeof vi.fn>;

  // Select operations
  select: ReturnType<typeof vi.fn>;
  selectDistinct: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  offset: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  for: ReturnType<typeof vi.fn>;

  // Update operations
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;

  // Delete operations
  delete: ReturnType<typeof vi.fn>;

  // Query API (Drizzle relational queries) - uses Proxy for dynamic table access
  query: {
    [key: string]: MockQueryTable;
  };

  // Execute raw SQL
  execute: ReturnType<typeof vi.fn>;

  // Transaction support
  transaction: ReturnType<typeof vi.fn>;

  // Reset all mocks
  _resetMocks: () => void;

  // Access to table cache for advanced testing
  _queryTableCache: Map<string, MockQueryTable>;

  // Configure return values
  _mockReturnValue: (method: string, value: unknown) => void;
  _mockResolvedValue: (method: string, value: unknown) => void;
  _mockRejectedValue: (method: string, error: Error) => void;
}

/**
 * Creates a chainable mock query builder
 */
export function createMockQueryBuilder(): MockQueryBuilder {
  const builder: Partial<MockQueryBuilder> = {};

  // Create chainable methods
  const chainableMethods = [
    'select',
    'from',
    'where',
    'orderBy',
    'limit',
    'offset',
    'leftJoin',
    'innerJoin',
    'groupBy',
    'having',
    'for',
  ] as const;

  for (const method of chainableMethods) {
    builder[method] = vi.fn().mockReturnThis();
  }

  // Execute returns a promise
  builder.execute = vi.fn().mockResolvedValue([]);

  return builder as MockQueryBuilder;
}

/**
 * Creates a mock query table with findFirst and findMany methods
 */
function createQueryTable(): MockQueryTable {
  return {
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
  };
}

/**
 * Creates a Proxy-based query object that dynamically creates table mocks
 * Any table access (e.g., query.user, query.appointment, query.organization)
 * automatically creates and caches a mock table with findFirst/findMany methods
 */
function createQueryProxy(
  tableCache: Map<string, MockQueryTable>
): MockDatabase['query'] {
  return new Proxy({} as MockDatabase['query'], {
    get(_target, prop: string) {
      // Return cached table mock or create a new one
      if (!tableCache.has(prop)) {
        tableCache.set(prop, createQueryTable());
      }
      return tableCache.get(prop) as MockQueryTable;
    },
  });
}

/**
 * Creates a mock database instance that simulates Drizzle ORM
 *
 * The query object uses a Proxy to dynamically create table mocks on-the-fly.
 * Any table access (e.g., mockDb.query.user, mockDb.query.appointment) will
 * automatically work without pre-defining the table.
 *
 * @example
 * ```typescript
 * import { createMockDatabase, vi } from '@borradh-workspace/testing';
 *
 * const mockDb = createMockDatabase();
 *
 * // Configure mock return value for any table - works automatically!
 * mockDb.query.user.findFirst.mockResolvedValueOnce({ id: '123', email: 'test@example.com' });
 * mockDb.query.appointment.findMany.mockResolvedValueOnce([{ id: '1' }, { id: '2' }]);
 * mockDb.returning.mockResolvedValueOnce([{ id: '123' }]);
 *
 * // Use in test
 * const result = await createUser(mockDb, { email: 'test@example.com', name: 'Test' });
 *
 * expect(mockDb.insert).toHaveBeenCalled();
 * expect(result.success).toBe(true);
 * ```
 */
export function createMockDatabase(): MockDatabase {
  const createChainableMock = () => {
    const mock = vi.fn();
    mock.mockReturnThis();
    return mock;
  };

  // Cache for dynamically created table mocks
  const queryTableCache = new Map<string, MockQueryTable>();

  const db: MockDatabase = {
    // Insert chain: db.insert(table).values(data).returning()
    insert: createChainableMock(),
    values: createChainableMock(),
    returning: vi.fn().mockResolvedValue([]),
    onConflictDoNothing: createChainableMock(),
    onConflictDoUpdate: createChainableMock(),

    // Select chain: db.select().from(table).where(condition)
    select: createChainableMock(),
    selectDistinct: createChainableMock(),
    from: createChainableMock(),
    where: createChainableMock(),
    orderBy: createChainableMock(),
    limit: createChainableMock(),
    offset: createChainableMock(),
    // Row-locking clause (SELECT … FOR UPDATE), chainable like the rest.
    for: createChainableMock(),
    leftJoin: createChainableMock(),
    innerJoin: createChainableMock(),

    // Update chain: db.update(table).set(data).where(condition).returning()
    update: createChainableMock(),
    set: createChainableMock(),

    // Delete chain: db.delete(table).where(condition).returning()
    delete: createChainableMock(),

    // Relational query API - uses Proxy for dynamic table creation
    query: createQueryProxy(queryTableCache),

    // Execute raw SQL
    execute: vi.fn().mockResolvedValue([]),

    // Transaction - passes the same db instance to maintain mock references
    transaction: vi.fn().mockImplementation(async (callback) => {
      return callback(db);
    }),

    // Cache reference for advanced testing scenarios
    _queryTableCache: queryTableCache,

    // Helper methods
    _resetMocks: () => {
      // Reset all top-level mock functions
      for (const [key, value] of Object.entries(db)) {
        if (key.startsWith('_')) continue; // Skip internal properties
        if (typeof value === 'function' && 'mockClear' in value) {
          value.mockClear();
        }
      }
      // Reset all cached table mocks
      for (const table of queryTableCache.values()) {
        table.findFirst.mockClear();
        table.findMany.mockClear();
      }
    },

    _mockReturnValue: (method: string, value: unknown) => {
      const fn = db[method as keyof MockDatabase];
      if (typeof fn === 'function' && 'mockReturnValue' in fn) {
        fn.mockReturnValue(value);
      }
    },

    _mockResolvedValue: (method: string, value: unknown) => {
      const fn = db[method as keyof MockDatabase];
      if (typeof fn === 'function' && 'mockResolvedValue' in fn) {
        fn.mockResolvedValue(value);
      }
    },

    _mockRejectedValue: (method: string, error: Error) => {
      const fn = db[method as keyof MockDatabase];
      if (typeof fn === 'function' && 'mockRejectedValue' in fn) {
        fn.mockRejectedValue(error);
      }
    },
  };

  return db;
}

/**
 * Creates a mock database that simulates transaction rollback on error
 *
 * Use this when you want to test that transactions properly rollback
 * when an error is thrown inside the transaction callback.
 *
 * @example
 * ```typescript
 * const mockDb = createMockDatabaseWithRollback();
 *
 * // Simulate an error during transaction
 * mockDb.returning.mockRejectedValueOnce(new Error('DB Error'));
 *
 * // The transaction should throw and rollback
 * await expect(someTransactionalOperation(mockDb)).rejects.toThrow('DB Error');
 * expect(mockDb._wasRolledBack).toBe(true);
 * ```
 */
export function createMockDatabaseWithRollback(): MockDatabase & {
  _wasRolledBack: boolean;
} {
  const db = createMockDatabase() as MockDatabase & { _wasRolledBack: boolean };
  db._wasRolledBack = false;

  db.transaction = vi.fn().mockImplementation(async (callback) => {
    db._wasRolledBack = false;
    try {
      return await callback(db);
    } catch (error) {
      db._wasRolledBack = true;
      throw error;
    }
  });

  return db;
}

/**
 * Helper to setup a mock transaction that will fail at a specific step
 *
 * @param mockDb - The mock database
 * @param failAtStep - Which step should fail (1-indexed)
 * @param error - The error to throw
 *
 * @example
 * ```typescript
 * const mockDb = createMockDatabaseWithRollback();
 *
 * // First operation succeeds, second fails
 * setupTransactionFailure(mockDb, 2, new Error('Second operation failed'));
 *
 * await expect(transferFunds(mockDb, 'from', 'to', 100)).rejects.toThrow();
 * expect(mockDb._wasRolledBack).toBe(true);
 * ```
 */
export function setupTransactionFailure(
  mockDb: MockDatabase,
  failAtStep: number,
  error: Error = new Error('Transaction failed')
): void {
  let callCount = 0;
  const originalReturning = mockDb.returning;

  mockDb.returning = vi.fn().mockImplementation(() => {
    callCount++;
    if (callCount >= failAtStep) {
      return Promise.reject(error);
    }
    return originalReturning();
  });
}
