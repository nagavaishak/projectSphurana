import { apiClient } from '@borradh-workspace/api-client';
import type {
  FaceGroupAsset,
  FaceGroupAssetRole,
} from '@borradh-workspace/api-client/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface UpdateRoleParams {
  groupId: string;
  assetId: string;
  role: FaceGroupAssetRole;
}

export const useUpdateFaceGroupAssetRole = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ groupId, assetId, role }: UpdateRoleParams) =>
      apiClient.put<FaceGroupAsset>(
        `face-groups/${groupId}/assets/${assetId}/role`,
        { role }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['face-groups'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update role');
    },
  });

  return {
    updateRole: mutation.mutate,
    updateRoleAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
