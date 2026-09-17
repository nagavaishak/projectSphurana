import { queryOptions, useQuery } from '@tanstack/react-query';

import { assistantApiUrl, assistantRequestInit } from '@/lib/assistant-request';

/**
 * Live prompt-tuning override bundle (uncommitted dev tool). Mirrors the
 * `PromptOverrides` shape the assistant chat controller accepts. Sent with
 * each chat / prompt-preview request from the in-chat tuning panel; every
 * field is optional and absent fields fall back to the registered defaults.
 */
export interface PromptOverrides {
  persona?: string;
  skillIndex?: string;
  businessContext?: string;
  /** skill id → replacement Block 3 fragment (`default` maps to persona). */
  skillFragments?: Record<string, string>;
  /** tool name → replacement description (steers when/how it's called). */
  toolDescriptions?: Record<string, string>;
  /** Free text appended last to the system prompt, highest priority. */
  extraDirectives?: string;
}

export interface PromptConfigTool {
  name: string;
  feature: string;
  action: string;
  description: string;
  inputSchema: unknown;
}

export interface PromptConfigSkill {
  id: string;
  oneLineDescription: string;
  promptFragment: string;
}

export interface PromptConfig {
  blocks: { persona: string; skillIndex: string; businessContext: string };
  skills: PromptConfigSkill[];
  tools: PromptConfigTool[];
  loadedSkillIds: string[];
  skillRegistryVersion: number;
}

export const promptConfigQueryOptions = (conversationId?: string) =>
  queryOptions({
    queryKey: ['assistant', 'prompt-config', conversationId ?? null],
    queryFn: async (): Promise<PromptConfig> => {
      const res = await fetch(
        assistantApiUrl('prompt-config'),
        assistantRequestInit({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId }),
        })
      );
      if (!res.ok) throw new Error('Failed to load prompt config');
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });

/**
 * Loads the editable prompt surface (default block text, all skills, the full
 * tool catalogue) seeded with current defaults for the tuning panel.
 */
export const usePromptConfig = (conversationId?: string, enabled = true) => {
  const query = useQuery({
    ...promptConfigQueryOptions(conversationId),
    enabled,
  });
  return {
    config: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
  };
};
