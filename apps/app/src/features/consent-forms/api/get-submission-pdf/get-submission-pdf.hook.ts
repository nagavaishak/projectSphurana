import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Backend: GET consent-form-templates/submissions/:id/pdf → `{ url }`. */
const endpoint = (id: string) => `consent-form-templates/submissions/${id}/pdf`;

export interface SubmissionPdfResponse {
  url: string;
  expiresIn: number;
}

/**
 * Fetch a short-lived presigned URL for a signed submission's PDF and open
 * it. Modelled as a mutation (not a query): every click should mint a fresh
 * URL — the previous one expires within minutes.
 */
export const useGetSubmissionPdf = () => {
  const mutation = useMutation({
    mutationFn: (submissionId: string) =>
      apiClient.get<SubmissionPdfResponse>(endpoint(submissionId)),
    onSuccess: ({ url }) => {
      window.open(url, '_blank', 'noopener');
    },
    onError: (error: Error) => {
      toast.error(error.message || "Couldn't prepare the PDF");
    },
  });

  return {
    downloadSubmissionPdf: mutation.mutate,
    isDownloadingSubmissionPdf: mutation.isPending,
    /** The submission a download is currently in flight for. */
    downloadingSubmissionId: mutation.isPending ? mutation.variables : null,
  };
};
