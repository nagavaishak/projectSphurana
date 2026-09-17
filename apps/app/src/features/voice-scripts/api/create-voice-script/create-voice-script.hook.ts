import { apiClient } from '@borradh-workspace/api-client';
import { voiceScriptSchema } from '@borradh-workspace/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { VoiceScript } from '../types';
import type { CreateVoiceScriptInput } from './create-voice-script.input';
import { buildCreateVoiceScriptPayload } from './create-voice-script.payload';

interface UseCreateVoiceScriptOptions {
  onSuccess?: (script: VoiceScript) => void;
  onError?: (error: Error) => void;
}

export const useCreateVoiceScript = (options?: UseCreateVoiceScriptOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    // Surfaces pass the shared intent; the one builder assembles the body.
    mutationFn: (input: CreateVoiceScriptInput) =>
      apiClient.post<VoiceScript>(
        'voice-scripts',
        buildCreateVoiceScriptPayload(input),
        { schema: voiceScriptSchema }
      ),
    onSuccess: (script) => {
      queryClient.invalidateQueries({ queryKey: ['voice-scripts'] });
      toast.success('Voice script created');
      options?.onSuccess?.(script);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create voice script');
      options?.onError?.(error);
    },
  });

  return {
    createVoiceScript: mutation.mutate,
    createVoiceScriptAsync: mutation.mutateAsync,
    isCreating: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
