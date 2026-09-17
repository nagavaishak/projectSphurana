import { apiClient } from '@borradh-workspace/api-client';
import type { FaceGroup } from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { UpdateFaceGroupIntent } from './update-face-group.payload';
import { buildUpdateFaceGroupPayload } from './update-face-group.payload';

interface UseUpdateFaceGroupOptions {
  onSuccess?: (group: FaceGroup) => void;
}

export const useUpdateFaceGroup = (options?: UseUpdateFaceGroupOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({
      groupId,
      ...intent
    }: UpdateFaceGroupIntent & { groupId: string }) =>
      apiClient.put<FaceGroup>(
        `face-groups/${groupId}`,
        buildUpdateFaceGroupPayload(intent)
      ),
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ['face-groups'] });
      options?.onSuccess?.(group);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update face group');
    },
  });

  return {
    updateFaceGroup: mutation.mutate,
    updateFaceGroupAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
