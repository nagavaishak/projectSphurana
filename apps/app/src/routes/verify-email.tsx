import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { CheckCircle, Loader2, Mail, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { z } from 'zod';

import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useResendVerification } from '@/features/auth/use-resend-verification';
import { useVerifyEmail } from '@/features/auth/use-verify-email';
import { useSession } from '@/lib/session';

const verifyEmailSearchSchema = z.object({
  token: z.string().optional(),
  email: z.string().optional(),
});

export const Route = createFileRoute('/verify-email')({
  validateSearch: verifyEmailSearchSchema,
  component: VerifyEmailPage,
});

type VerificationState =
  | 'checking'
  | 'verifying'
  | 'verified'
  | 'error'
  | 'awaiting';

function VerifyEmailPage() {
  const navigate = useNavigate();
  const { token, email } = Route.useSearch();
  const session = useSession();

  const [state, setState] = useState<VerificationState>(
    token ? 'checking' : 'awaiting'
  );
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [resendEmail, setResendEmail] = useState(email ?? '');

  const { verifyEmail, isVerifying } = useVerifyEmail({
    onSuccess: () => setState('verified'),
    onError: (error) => {
      setState('error');
      setErrorMessage(error.message || 'Invalid or expired verification link');
    },
  });

  const {
    resendVerification,
    isResending,
    isSuccess: resendSuccess,
  } = useResendVerification();

  // Auto-verify if token is present
  useEffect(() => {
    if (token && state === 'checking') {
      setState('verifying');
      verifyEmail({ token });
    }
  }, [token, state, verifyEmail]);

  // Poll session while awaiting external verification (e.g. another tab)
  useEffect(() => {
    if (state !== 'awaiting') return;
    const id = setInterval(() => session.refetch(), 3000);
    return () => clearInterval(id);
  }, [state, session]);

  useEffect(() => {
    if (state === 'awaiting' && session.data?.user?.emailVerified) {
      setState('verified');
    }
  }, [state, session.data?.user?.emailVerified]);

  // Redirect to onboarding after success.
  // The legacy wizard is the live flow; the Claire Typeform flow at /welcome is
  // built and reachable but not the default. Flip this (and the sign-up
  // redirect) to '/welcome' to switch over.
  useEffect(() => {
    if (state !== 'verified') return;
    const timer = setTimeout(
      () => navigate({ to: '/onboarding', replace: true }),
      2000
    );
    return () => clearTimeout(timer);
  }, [state, navigate]);

  const handleResend = () => {
    if (resendEmail) {
      // Must match the post-verify redirect above: the legacy wizard is the live
      // onboarding flow, so the link in the email has to land there too.
      resendVerification({ email: resendEmail, callbackURL: '/onboarding' });
    }
  };

  if (state === 'verifying' || isVerifying) {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center gap-4 text-center">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <h1 className="text-2xl font-bold">Verifying your email</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Please wait while we verify your email address...
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (state === 'verified') {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center gap-4 text-center">
          <CheckCircle className="h-12 w-12 text-green-500" />
          <h1 className="text-2xl font-bold">Email verified!</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Your email has been verified successfully. Redirecting to
            onboarding...
          </p>
        </div>
      </AuthLayout>
    );
  }

  if (state === 'error') {
    return (
      <AuthLayout>
        <div className="flex flex-col items-center gap-4 text-center">
          <XCircle className="h-12 w-12 text-destructive" />
          <h1 className="text-2xl font-bold">Verification failed</h1>
          <p className="text-muted-foreground text-sm text-balance">
            {errorMessage}
          </p>
          <div className="w-full mt-4">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="email">Email address</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </Field>
              <Button
                onClick={handleResend}
                disabled={isResending || !resendEmail}
                className="w-full"
              >
                {isResending ? 'Sending...' : 'Resend verification email'}
              </Button>
              {resendSuccess && (
                <p className="text-sm text-green-600">
                  Verification email sent! Check your inbox.
                </p>
              )}
            </FieldGroup>
          </div>
        </div>
      </AuthLayout>
    );
  }

  // Default — awaiting verification
  return (
    <AuthLayout>
      <div className="flex flex-col items-center gap-4 text-center">
        <Mail className="h-12 w-12 text-primary" />
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-muted-foreground text-sm text-balance">
          We've sent a verification link to your email address. Click the link
          to verify your account.
        </p>
        <div className="w-full mt-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="email">Didn't receive an email?</FieldLabel>
              <Input
                id="email"
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                placeholder="Enter your email"
              />
              <FieldDescription>
                Enter your email to resend the verification link
              </FieldDescription>
            </Field>
            <Button
              onClick={handleResend}
              disabled={isResending || !resendEmail}
              variant="outline"
              className="w-full"
            >
              {isResending ? 'Sending...' : 'Resend verification email'}
            </Button>
            {resendSuccess && (
              <p className="text-sm text-green-600 text-center">
                Verification email sent! Check your inbox.
              </p>
            )}
            <FieldDescription className="text-center">
              <Link to="/sign-in" className="underline underline-offset-4">
                Back to sign in
              </Link>
            </FieldDescription>
          </FieldGroup>
        </div>
      </div>
    </AuthLayout>
  );
}
