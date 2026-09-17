import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';

interface CreateMobileTokenInput {
  videoId: string;
  /** Teleprompter script, carried in the token so an auth-free phone can render it. */
  scriptText?: string;
}

interface MobileTokenResponse {
  token: string;
  deepLinkUrl: string;
  expiresIn: number;
}

export const useCreateMobileToken = () => {
  const mutation = useMutation({
    mutationFn: (input: CreateMobileTokenInput) =>
      apiClient.post<MobileTokenResponse>('upload/mobile-token', input),
  });

  return {
    createToken: mutation.mutate,
    createTokenAsync: mutation.mutateAsync,
    tokenData: mutation.data ?? null,
    isCreating: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
};
