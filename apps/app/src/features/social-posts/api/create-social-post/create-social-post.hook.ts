import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import { apiClient } from '@borradh-workspace/api-client';
import { socialPostSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SocialPost } from '../../types';
import type { CreateSocialPostIntent } from './create-social-post.input';
import { buildCreateSocialPostPayload } from './create-social-post.payload';

export const useCreateSocialPost = (options?: {
  onSuccess?: (post: SocialPost) => void;
  onError?: (error: Error) => void;
  showToast?: boolean;
}) => {
  const queryClient = useQueryClient();
  const showToast = options?.showToast ?? true;
  // The chosen date/time is a wall-clock in the BUSINESS timezone, not the
  // scheduler's device — resolve it here so every create surface agrees (ENG-738).
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  const mutation = useMutation({
    mutationFn: async (intent: CreateSocialPostIntent) => {
      return apiClient.post<SocialPost>(
        'social-posts',
        buildCreateSocialPostPayload(intent, timeZone),
        { schema: socialPostSchema }
      );
    },
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: ['social-posts'] });
      if (showToast) {
        toast.success('Post created successfully');
      }
      options?.onSuccess?.(post);
    },
    onError: (error: Error) => {
      if (showToast) {
        toast.error(error.message || 'Failed to create post');
      }
      options?.onError?.(error);
    },
  });

  return {
    createSocialPost: mutation.mutate,
    createSocialPostAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
