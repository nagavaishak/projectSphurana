import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type ToggleInstagramChatbotInput,
  buildToggleInstagramChatbotPayload,
} from './toggle-instagram-chatbot.payload';

interface ToggleInstagramChatbotResult {
  isChatbotActive: boolean;
}

/**
 * Toggle the Instagram chatbot on/off via `PUT integrations/instagram/chatbot`.
 *
 * Wraps the write that used to be inlined in three components. Each surface
 * passes its {@link ToggleInstagramChatbotInput} intent and supplies its own
 * `onSuccess`/`onError` (per-call, via the returned `mutate`) for its
 * surface-specific toast / optimistic-revert behaviour — the hook always
 * invalidates the integration + organization queries the caches depend on.
 */
export const useToggleInstagramChatbot = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: ToggleInstagramChatbotInput) =>
      apiClient.put<ToggleInstagramChatbotResult>(
        'integrations/instagram/chatbot',
        buildToggleInstagramChatbotPayload(input)
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      queryClient.invalidateQueries({ queryKey: ['organization'] });
    },
  });

  return {
    toggleInstagramChatbot: mutation.mutate,
    toggleInstagramChatbotAsync: mutation.mutateAsync,
    isToggling: mutation.isPending,
  };
};
