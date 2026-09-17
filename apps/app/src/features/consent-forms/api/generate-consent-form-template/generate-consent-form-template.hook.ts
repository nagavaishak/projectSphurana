import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import type { ConsentFormTemplateField } from '../types';

/** Backend endpoint — a static segment on the templates controller. */
const ENDPOINT = 'consent-form-templates/generate';

export interface GenerateConsentFormTemplateInput {
  /** Free-text description of the form the clinic wants. */
  prompt: string;
}

/** Draft returned by "Write with AI" — matches the create-template shape. */
export interface GeneratedConsentFormTemplate {
  title: string;
  body: string;
  fields: ConsentFormTemplateField[];
  requiresSignature: boolean;
}

/**
 * "Write with AI" for consent templates — POSTs a description, gets back a full
 * draft the dialog drops into the form. Nothing is persisted server-side; the
 * clinician reviews and saves via the normal create flow.
 */
export const useGenerateConsentFormTemplate = (options?: {
  onSuccess?: (draft: GeneratedConsentFormTemplate) => void;
  onError?: (error: Error) => void;
}) => {
  const mutation = useMutation({
    mutationFn: (input: GenerateConsentFormTemplateInput) =>
      apiClient.post<GeneratedConsentFormTemplate>(ENDPOINT, input),
    onSuccess: (draft) => {
      options?.onSuccess?.(draft);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to draft the form');
      options?.onError?.(error);
    },
  });

  return {
    generateTemplate: mutation.mutate,
    generateTemplateAsync: mutation.mutateAsync,
    isGenerating: mutation.isPending,
    generatedTemplate: mutation.data ?? null,
    reset: mutation.reset,
  };
};
