import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  OnboardingStagedCampaign,
  StageOnboardingCampaignInput,
} from '../../types';

interface UseStageCampaignOptions {
  onSuccess?: (staged: OnboardingStagedCampaign) => void;
  onError?: (error: Error) => void;
}

/**
 * Stage the campaign locally (budget, targeting, nurture channel, draft lead
 * form) BEFORE Meta is connected — the launch orchestrator replays it after
 * the FLfB popup succeeds.
 */
export const useStageCampaign = (options?: UseStageCampaignOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: StageOnboardingCampaignInput = {}) =>
      apiClient.post<OnboardingStagedCampaign>(
        'onboarding/stage-campaign',
        input
      ),
    onSuccess: (staged) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(staged);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to stage the campaign');
      options?.onError?.(error);
    },
  });

  return {
    stageCampaign: mutation.mutate,
    stageCampaignAsync: mutation.mutateAsync,
    stagedCampaign: mutation.data ?? null,
    isStaging: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
  };
};
