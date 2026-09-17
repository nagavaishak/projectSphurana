import { apiClient } from '@borradh-workspace/api-client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  LaunchOnboardingCampaignResponse,
  OnboardingLaunchProgress,
  OnboardingLaunchStep,
} from '../../types';

/**
 * Error thrown by `useLaunchCampaign` — carries the launch orchestrator's
 * `step` + `launchProgress` from the error body so the meta-connect slide
 * can show a step-specific message and offer a resume-retry (the endpoint
 * is idempotent: re-invoking skips completed steps).
 */
export class OnboardingLaunchError extends Error {
  readonly step?: OnboardingLaunchStep;
  readonly launchProgress?: OnboardingLaunchProgress;

  constructor(
    message: string,
    step?: OnboardingLaunchStep,
    launchProgress?: OnboardingLaunchProgress
  ) {
    super(message);
    this.name = 'OnboardingLaunchError';
    this.step = step;
    this.launchProgress = launchProgress;
  }
}

/**
 * Read `{ message, step, launchProgress }` off the /launch error body. The
 * api-client's beforeError hook skips body parsing for 5xx responses (and a
 * Meta failure maps to 502), so read the raw ky HTTPError response here.
 */
const toLaunchError = async (error: unknown): Promise<Error> => {
  if (!(error instanceof Error)) return new Error(String(error));

  const response = (error as { response?: unknown }).response;
  if (response instanceof Response) {
    try {
      const body = (await response.clone().json()) as {
        message?: string;
        step?: OnboardingLaunchStep;
        launchProgress?: OnboardingLaunchProgress;
      };
      return new OnboardingLaunchError(
        body.message || error.message,
        body.step,
        body.launchProgress
      );
    } catch {
      // Body not JSON / already consumed — fall through.
    }
  }
  return error;
};

interface UseLaunchCampaignOptions {
  onSuccess?: (data: LaunchOnboardingCampaignResponse) => void;
  /** Check `error instanceof OnboardingLaunchError` for step/launchProgress. */
  onError?: (error: Error) => void;
}

/**
 * Run the launch orchestrator (REAL Meta spend). Idempotent / resumable —
 * on failure re-invoke and completed steps are skipped. No toast here: the
 * meta-connect slide renders step-specific failure states itself.
 */
export const useLaunchCampaign = (options?: UseLaunchCampaignOptions) => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async () => {
      try {
        return await apiClient.post<LaunchOnboardingCampaignResponse>(
          'onboarding/launch'
        );
      } catch (error) {
        throw await toLaunchError(error);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['onboarding', 'session'] });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      options?.onError?.(error);
    },
  });

  return {
    launchCampaign: mutation.mutate,
    launchCampaignAsync: mutation.mutateAsync,
    launchResult: mutation.data ?? null,
    launchError: mutation.error,
    isLaunching: mutation.isPending,
    isSuccess: mutation.isSuccess,
    isError: mutation.isError,
    reset: mutation.reset,
  };
};
