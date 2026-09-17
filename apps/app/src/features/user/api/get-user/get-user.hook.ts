'use client';

import { apiClient } from '@borradh-workspace/api-client';
import { queryOptions, useQuery } from '@tanstack/react-query';

/**
 * User response type from API
 */
export interface UserResponse {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  organizationId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Query options for get user (enables prefetching, invalidation)
 */
export const getUserQueryOptions = (userId: string) => {
  return queryOptions({
    queryKey: ['user', userId],
    queryFn: async () => {
      return apiClient.get<UserResponse>(`users/${userId}`);
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: !!userId,
  });
};

/**
 * Get User Hook
 * Returns a user by ID via NestJS API
 *
 * @param userId - The user ID to fetch
 */
export const useGetUser = (userId: string) => {
  const query = useQuery(getUserQueryOptions(userId));

  return {
    user: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
