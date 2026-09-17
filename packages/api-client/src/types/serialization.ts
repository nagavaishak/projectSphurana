/**
 * @borradh-workspace/api-client - Serialization Utility Types
 *
 * These utility types transform backend types to their JSON-serialized equivalents,
 * ensuring type safety between the API layer and frontend consumers.
 */

/**
 * Transforms a type to its JSON-serialized equivalent:
 * - Date -> string (ISO format)
 * - Recursively applies to nested objects and arrays
 * - Preserves null and undefined (they fall through the conditionals unchanged)
 *
 * Distribution note: conditional types distribute over naked union members, so
 * `Serialize<string[] | undefined>` evaluates per member — `string[]` hits the
 * Array branch and `undefined` falls through to the final `T`. Do NOT add
 * helper branches like `T extends Date | null` to "handle" nullable dates:
 * those branches swallow every non-Date member of the union and widen the
 * result (e.g. `string[] | undefined` collapsing to `string[] | string | undefined`).
 * The current form is correct for all observed callers.
 */
export type Serialize<T> = T extends Date
  ? string
  : T extends Array<infer U>
    ? Array<Serialize<U>>
    : T extends object
      ? { [K in keyof T]: Serialize<T[K]> }
      : T;

/**
 * Converts specified numeric string fields to numbers.
 * Use for Drizzle numeric columns that return strings.
 *
 * Uses the same non-distributive pattern as `Serialize<T>`: each union member
 * is handled individually, so `string | null` maps to `number | null` without
 * needing explicit `string | null` / `string | undefined` branches that would
 * double-count union members.
 *
 * @example
 * type Good = { quantity: string; unitPrice: string | null };
 * type ApiGood = NumericFields<Good, 'quantity' | 'unitPrice'>;
 * // Result: { quantity: number; unitPrice: number | null }
 */
export type NumericFields<T, K extends keyof T> = Omit<T, K> & {
  [P in K]: T[P] extends string ? number : T[P];
};

/**
 * Full API response transformation.
 * Combines serialization with numeric field conversion.
 *
 * @example
 * type BackendGood = { quantity: string; createdAt: Date };
 * type ApiGood = ApiResponse<BackendGood, 'quantity'>;
 * // Result: { quantity: number; createdAt: string }
 */
export type ApiResponse<
  T,
  NumericKeys extends keyof Serialize<T> = never,
> = NumericFields<Serialize<T>, NumericKeys>;

/**
 * Makes specified keys optional in a type.
 * Useful for creating input types from entity types.
 */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/**
 * Makes specified keys required in a type.
 */
export type RequiredBy<T, K extends keyof T> = Omit<T, K> &
  Required<Pick<T, K>>;

/**
 * Extracts the inner type from a Promise or async function return type.
 */
export type Awaited<T> = T extends Promise<infer U> ? U : T;

/**
 * Extracts the data type from a Result<T> type.
 */
export type ExtractResultData<T> = T extends { success: true; data: infer D }
  ? D
  : never;
