import { useMutation } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';
import type { PromptOverrides } from './use-prompt-config';

export interface PromptPreviewResult {
  /** Full assembled system prompt (all blocks joined), with overrides applied. */
  prompt: string;
  blockCount: number;
  loadedSkillIds: string[];
  skillRegistryVersion: number;
}

export interface PromptPreviewInput {
  conversationId?: string;
  overrides?: PromptOverrides;
}

/**
 * On-demand assembly of the exact system prompt the next chat turn would send
 * (knowledge/RAG + active-context excluded — those are per-message). Lets the
 * tuning panel show the final prompt after overrides are applied.
 */
export const usePromptPreview = () => {
  const mutation = useMutation({
    mutationFn: async (
      input: PromptPreviewInput
    ): Promise<PromptPreviewResult> => {
      const res = await fetch(
        assistantApiUrl('prompt-preview'),
        assistantRequestInit({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        })
      );
      if (!res.ok) throw new Error('Failed to load prompt preview');
      return res.json();
    },
  });

  return {
    previewPrompt: mutation.mutateAsync,
    isPreviewing: mutation.isPending,
    preview: mutation.data ?? null,
    previewError: mutation.error,
  };
};
