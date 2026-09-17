import { apiClient } from '@borradh-workspace/api-client';
import { voiceScriptSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { VoiceScript } from '../types';
import type { UpdateVoiceScriptInput } from './update-voice-script.input';
import { buildUpdateVoiceScriptPayload } from './update-voice-script.payload';

interface UseUpdateVoiceScriptOptions {
  onSuccess?: (script: VoiceScript) => void;
  onError?: (error: Error) => void;
}

export const useUpdateVoiceScript = (options?: UseUpdateVoiceScriptOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: ({ id, ...input }: UpdateVoiceScriptInput & { id: string }) =>
      apiClient.put<VoiceScript>(
        `voice-scripts/${id}`,
        buildUpdateVoiceScriptPayload(input),
        { schema: voiceScriptSchema }
      ),
    onSuccess: (script) => {
      queryClient.invalidateQueries({ queryKey: ['voice-scripts'] });
      queryClient.invalidateQueries({ queryKey: ['voice-scripts', script.id] });
      toast.success('Voice script updated');
      options?.onSuccess?.(script);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to update voice script');
      options?.onError?.(error);
    },
  });

  return {
    updateVoiceScript: mutation.mutate,
    updateVoiceScriptAsync: mutation.mutateAsync,
    isUpdating: mutation.isPending,
  };
};
