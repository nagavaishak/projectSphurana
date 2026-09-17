import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import { apiClient } from '@borradh-workspace/api-client';
import { socialPostSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SocialPost } from '../../types';
import type { UpdateSocialPostIntent } from './update-social-post.input';
import { buildUpdateSocialPostPayload } from './update-social-post.payload';

export const useUpdateSocialPost = (options?: {
  onSuccess?: (post: SocialPost) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();
  // A reschedule's date/time is a wall-clock in the BUSINESS timezone; the
  // drag-drop `at` instant is already absolute and passes through untouched.
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  const mutation = useMutation({
    mutationFn: async (intent: UpdateSocialPostIntent) => {
      return apiClient.put<SocialPost>(
        `social-posts/${intent.id}`,
        buildUpdateSocialPostPayload(intent, timeZone),
        { schema: socialPostSchema }
      );
    },
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: ['social-posts'] });
      queryClient.invalidateQueries({ queryKey: ['social-posts', post.id] });
      toast.success('Post updated successfully');
      options?.onSuccess?.(post);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update post');
      options?.onError?.(error);
    },
  });

  return {
    updateSocialPost: mutation.mutate,
    updateSocialPostAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
