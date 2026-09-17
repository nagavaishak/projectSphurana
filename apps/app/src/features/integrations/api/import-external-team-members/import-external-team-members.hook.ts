import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ImportMember {
  externalId: string;
  name: string;
  email: string;
  selected: boolean;
}

interface ImportResult {
  created: Array<{ id: string; name: string; email: string }>;
  linked: Array<{ id: string; name: string; email: string }>;
  skipped: string[];
}

interface UseImportExternalTeamMembersOptions {
  onSuccess?: (result: ImportResult) => void;
  onError?: (error: Error) => void;
}

export const useImportExternalTeamMembers = (
  accountId: string,
  options?: UseImportExternalTeamMembersOptions
) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (members: ImportMember[]) =>
      apiClient.post<ImportResult>(
        `integrations/booking/accounts/${accountId}/import-team-members`,
        { members }
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['practitioners'] });
      const total = result.created.length + result.linked.length;
      if (total > 0) {
        toast.success(`${total} team member${total > 1 ? 's' : ''} imported`);
      }
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to import team members');
      options?.onError?.(error);
    },
  });

  return {
    importMembers: mutation.mutate,
    importMembersAsync: mutation.mutateAsync,
    isImporting: mutation.isPending,
    isSuccess: mutation.isSuccess,
  };
};
