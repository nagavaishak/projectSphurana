import { apiClient } from '@borradh-workspace/api-client';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

interface ResendVerificationInput {
  email: string;
  callbackURL?: string;
}

interface ResendVerificationResponse {
  success: boolean;
  message: string;
}

interface UseResendVerificationOptions {
  onSuccess?: (data: ResendVerificationResponse) => void;
  onError?: (error: Error) => void;
}

export function useResendVerification(options?: UseResendVerificationOptions) {
  const mutation = useMutation({
    mutationFn: (input: ResendVerificationInput) =>
      apiClient.post<ResendVerificationResponse>(
        'auth/resend-verification',
        input
      ),
    onSuccess: (data) => {
      toast.success(data.message || 'Verification email sent');
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send verification email');
      options?.onError?.(error);
    },
  });

  return {
    resendVerification: mutation.mutate,
    isResending: mutation.isPending,
    isSuccess: mutation.isSuccess,
  };
}
