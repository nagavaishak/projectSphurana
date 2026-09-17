import type { Database } from '@borradh-workspace/database';

// Re-export Database type for convenience
export type { Database };

/**
 * Transaction type - same interface as Database
 * Services accept Database | Transaction, making them transaction-agnostic
 *
 * @example
 * ```ts
 * // Without transaction
 * await createUser(db, input);
 *
 * // With transaction
 * await db.transaction(async (tx) => {
 *   const user = await createUser(tx, userInput);
 *   if (!user.success) throw new Error(user.error.message);
 *
 *   const org = await createOrganization(tx, orgInput);
 *   if (!org.success) throw new Error(org.error.message);
 *
 *   return { user: user.data, org: org.data };
 * });
 * ```
 */
export type Transaction = Database;

/**
 * Database connection - can be either a direct connection or a transaction
 * Use this type in service function signatures
 */
export type DbConnection = Database | Transaction;

/**
 * Context passed to all feature services
 * Can be extended to include user info, request context, etc.
 */
export interface ServiceContext {
  db: DbConnection;
  userId?: string;
  requestId?: string;
}

/**
 * Pagination parameters for list operations
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
}

/**
 * Paginated result wrapper
 */
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  nextCursor?: string;
}

/**
 * Common sort direction
 */
export type SortDirection = 'asc' | 'desc';

/**
 * Base entity with common fields
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}
