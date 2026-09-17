import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

export interface TemplatePreviewInput {
  /** Group template id (e.g. `caption-tease`, `authority`). */
  templateId?: string;
  /** Specific variation id; resolved from `templateId` when omitted. */
  variationId?: string;
  /** Optional service to seed copy; auto-picked server-side when omitted. */
  serviceId?: string;
  /** Required for the `offer` template. */
  offerId?: string;
  /** Which engine to render through. */
  version: 'v1' | 'v2';
}

export interface TemplatePreviewResult {
  videoId: string;
}

/**
 * Render one template through the legacy (`v1`) or renderdoc (`v2`) engine.
 * Each call creates a fresh video row, so the caller can fire v1 and v2
 * independently and poll each `videoId` for status + `blobUrl`.
 */
export const useTemplatePreview = (options?: {
  onSuccess?: (
    result: TemplatePreviewResult,
    input: TemplatePreviewInput
  ) => void;
  onError?: (error: Error, input: TemplatePreviewInput) => void;
}) => {
  const mutation = useMutation({
    mutationFn: async (input: TemplatePreviewInput) =>
      apiClient.post<TemplatePreviewResult>('videos/template-preview', input),
    onSuccess: (result, input) => {
      options?.onSuccess?.(result, input);
    },
    onError: (error: Error, input) => {
      toast.error(error.message || 'Failed to start render');
      options?.onError?.(error, input);
    },
  });

  return {
    generatePreview: mutation.mutate,
    generatePreviewAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
  };
};
