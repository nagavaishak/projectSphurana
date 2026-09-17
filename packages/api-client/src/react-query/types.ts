// @borradh-workspace/api-client/react-query - Type utilities

import type { UseMutationOptions } from '@tanstack/react-query';

/**
 * Extract the return type from an async function
 *
 * @example
 * ```typescript
 * const getUser = async (id: string): Promise<User> => { ... };
 * type UserResult = ApiFnReturnType<typeof getUser>; // User
 * ```
 */
export type ApiFnReturnType<
  FnType extends (...args: unknown[]) => Promise<unknown>,
> = Awaited<ReturnType<FnType>>;

/**
 * Type utility for customizing query options
 * Omits queryKey and queryFn since they're provided by the hook
 *
 * @example
 * ```typescript
 * export const useUser = ({
 *   userId,
 *   queryConfig,
 * }: {
 *   userId: string;
 *   queryConfig?: QueryConfig<typeof getUserQueryOptions>;
 * }) => {
 *   return useQuery({
 *     ...getUserQueryOptions(userId),
 *     ...queryConfig,
 *   });
 * };
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: Required for generic utility type
export type QueryConfig<T extends (...args: any[]) => any> = Omit<
  ReturnType<T>,
  'queryKey' | 'queryFn'
>;

/**
 * Type utility for customizing mutation options
 *
 * @example
 * ```typescript
 * export const useCreateUser = ({
 *   mutationConfig,
 * }: {
 *   mutationConfig?: MutationConfig<typeof createUser>;
 * } = {}) => {
 *   return useMutation({
 *     mutationFn: createUser,
 *     ...mutationConfig,
 *   });
 * };
 * ```
 */
export type MutationConfig<
  MutationFnType extends (...args: unknown[]) => Promise<unknown>,
> = UseMutationOptions<
  ApiFnReturnType<MutationFnType>,
  Error,
  Parameters<MutationFnType>[0]
>;
