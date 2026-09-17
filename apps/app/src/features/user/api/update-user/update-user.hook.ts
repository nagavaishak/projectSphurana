'use client';

import { logError } from '@/lib/log-error';
import { invalidateKeys, queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UserResponse } from '../get-user';
import type { UpdateUserInput } from './update-user.input';
import { buildUpdateUserPayload } from './update-user.payload';

/**
 * Update User Hook
 * Updates a user via NestJS API
 *
 * @param userId - The user ID to update
 * @param options.onSuccess - Custom success callback
 * @param options.onError - Custom error callback
 */
export const useUpdateUser = (
  userId: string,
  options?: {
    onSuccess?: (data: UserResponse) => void;
    onError?: (error: Error) => void;
  }
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (data: UpdateUserInput) => {
      // Surfaces pass the shared intent; the one builder assembles the body.
      return apiClient.put<UserResponse>(
        `users/${userId}`,
        buildUpdateUserPayload(data)
      );
    },
    onSuccess: (data, variables) => {
      // The session embeds the user's name/image, so it has to be refetched
      // for the avatar + nav to update. This used to invalidate `['session']`
      // — a key no query has, so it did nothing.
      invalidateKeys(
        queryClient,
        queryKeys.user.detail(userId),
        queryKeys.auth.session()
      );

      // Changing the profile photo also mirrors onto the linked practitioner's
      // `photo` (server-side), which is what the calendar and public booking
      // page render — so refresh those lists to show the new photo without a
      // reload.
      if ('image' in variables) {
        invalidateKeys(queryClient, queryKeys.practitioners.all());
      }

      toast.success('User updated successfully');

      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      // Capture full error context (apiClient attaches status, code, details).
      const errWithExtras = error as Error & {
        code?: string;
        details?: Record<string, unknown>;
        response?: { status?: number; url?: string };
      };
      logError('user.updateUser', error, {
        feature: 'user',
        extra: {
          userId,
          errorMessage: error.message,
          errorName: error.name,
          errorCode: errWithExtras.code,
          errorDetails: errWithExtras.details,
          httpStatus: errWithExtras.response?.status,
          requestUrl: errWithExtras.response?.url,
          cause:
            error.cause instanceof Error
              ? { message: error.cause.message, name: error.cause.name }
              : error.cause,
        },
      });

      const userMessage =
        error.message && error.message !== 'Error in updateUser'
          ? error.message
          : 'Failed to update user';
      toast.error(userMessage);
      options?.onError?.(error);
    },
  });

  return {
    ...mutation,
    execute: mutation.mutate,
    executeAsync: mutation.mutateAsync,
    isExecuting: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
