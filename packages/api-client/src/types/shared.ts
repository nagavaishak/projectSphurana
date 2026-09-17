/**
 * @borradh-workspace/api-client - Shared Types
 *
 * Common types used across multiple features.
 */

/**
 * Standard paginated response structure.
 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Standard list response (simpler pagination).
 */
export interface ListResponse<T> {
  items: T[];
  total: number;
}

/**
 * Response with a single item wrapper.
 */
export interface SingleResponse<T> {
  data: T;
}

/**
 * Common pagination input parameters.
 */
export interface PaginationParams {
  limit?: number;
  offset?: number;
}

/**
 * Result type for API responses that can succeed or fail.
 */
export type Result<T, E = ApiResultError> =
  | { success: true; data: T }
  | { success: false; error: E };

/**
 * Standard API error structure.
 */
export interface ApiResultError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Date range filter parameters.
 */
export interface DateRangeParams {
  startDateFrom?: string;
  startDateTo?: string;
}

/**
 * Common status values for entities.
 */
export type CommonStatus = 'active' | 'inactive' | 'archived' | 'deleted';
