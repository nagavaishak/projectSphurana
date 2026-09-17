'use client';

import { queryKeys } from '@/lib/query-keys';
import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  IssueIntakeSubmissionInput,
  IssueIntakeSubmissionResponse,
} from '../types';

/**
 * Mint a fill-in link for a patient. Returns the RAW token (in `result.token`);
 * the caller builds the send URL from it — the clinic copies or sends the link.
 */
export const useIssueIntakeSubmission = (options?: {
  onSuccess?: (result: IssueIntakeSubmissionResponse) => void;
}) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: IssueIntakeSubmissionInput) =>
      apiClient.post<IssueIntakeSubmissionResponse>(
        'intake-forms/issue',
        input
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.intakeForms.submissions(),
      });
      options?.onSuccess?.(result);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create the link');
    },
  });

  return {
    issueSubmission: mutation.mutate,
    issueSubmissionAsync: mutation.mutateAsync,
    isIssuing: mutation.isPending,
  };
};
