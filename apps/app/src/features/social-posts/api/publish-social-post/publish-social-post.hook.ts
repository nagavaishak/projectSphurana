import { apiClient } from '@borradh-workspace/api-client';
import { socialPostSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SocialPost } from '../../types';

export const usePublishSocialPost = (options?: {
  onSuccess?: (post: SocialPost) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (id: string) => {
      return apiClient.post<SocialPost>(
        `social-posts/${id}/publish`,
        undefined,
        { schema: socialPostSchema }
      );
    },
    onSuccess: (post) => {
      queryClient.invalidateQueries({ queryKey: ['social-posts'] });
      queryClient.invalidateQueries({ queryKey: ['social-posts', post.id] });

      // Show appropriate toast based on status
      if (post.status === 'published') {
        toast.success('Post published successfully to all platforms');
      } else if (post.status === 'partial') {
        toast.warning('Post partially published - some platforms failed');
      } else if (post.status === 'failed') {
        toast.error('Post publishing failed');
      } else if (post.status === 'publishing') {
        toast.success('Publishing started — this may take a moment');
      }

      options?.onSuccess?.(post);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to publish post');
      options?.onError?.(error);
    },
  });

  return {
    publishSocialPost: mutation.mutate,
    publishSocialPostAsync: mutation.mutateAsync,
    isPublishing: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    error: mutation.error,
  };
};
