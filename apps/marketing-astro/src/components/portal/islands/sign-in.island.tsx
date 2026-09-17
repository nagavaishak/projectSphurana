'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import * as React from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { getErrorStatus } from '../api/paths';
import { PortalProvider, usePortalNavigate } from '../api/portal-provider';
import { useRequestOtp } from '../api/request-otp.hook';
import { useVerifyOtp } from '../api/verify-otp.hook';
import { OTP_LENGTH, OtpInput, type OtpInputHandle } from '../otp-input';
import { PortalAuthLayout } from '../portal-auth-layout';
import type { PortalContext } from '../portal-context';

/**
 * Portal v2 auth is passwordless (email OTP + magic link) — an email address
 * and a six-digit code are the only two things a customer ever types here.
 */
const patientEmailFormSchema = z.object({
  // `.email()` on a ZodString is deprecated in zod 4; `z.email()` is the
  // supported spelling, piped so the empty-string case still reports
  // "Email is required" rather than "Enter a valid email".
  email: z
    .string()
    .min(1, 'Email is required')
    .pipe(z.email('Enter a valid email')),
});
type PatientEmailFormValues = z.infer<typeof patientEmailFormSchema>;

const RESEND_COOLDOWN_SECONDS = 60;

/** Ticks once a second while a deadline is set; 0 once it passes. */
function useResendCountdown() {
  const [deadline, setDeadline] = React.useState<number | null>(null);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    if (deadline === null || deadline <= now) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [deadline, now]);

  const secondsLeft =
    deadline === null ? 0 : Math.max(0, Math.ceil((deadline - now) / 1000));

  const restart = React.useCallback(() => {
    const at = Date.now();
    setNow(at);
    setDeadline(at + RESEND_COOLDOWN_SECONDS * 1000);
  }, []);

  return { secondsLeft, restart };
}

function requestErrorMessage(error: Error | null): string | null {
  if (!error) return null;
  if (getErrorStatus(error) === 429) {
    return 'Too many requests — try again in a few minutes';
  }
  return error.message || 'Something went wrong. Please try again.';
}

function verifyErrorMessage(error: Error | null): string | null {
  if (!error) return null;
  const status = getErrorStatus(error);
  if (status === 401) return "That code didn't work or has expired.";
  if (status === 429) return 'Too many attempts — try again in a few minutes';
  return error.message || 'Something went wrong. Please try again.';
}

function SignInForm({ organizationSlug }: { organizationSlug: string }) {
  const navigate = usePortalNavigate();

  const [step, setStep] = React.useState<'email' | 'code'>('email');
  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');
  const otpRef = React.useRef<OtpInputHandle>(null);
  const { secondsLeft, restart: restartCooldown } = useResendCountdown();

  const requestMutation = useRequestOtp({
    onSuccess: () => {
      // ALWAYS advance — the response is neutral by design (no enumeration).
      setStep('code');
      setCode('');
      restartCooldown();
    },
  });
  const { requestOtp, isRequestingOtp } = requestMutation;

  const verifyMutation = useVerifyOtp({
    // The session cookie is set on this response. `replace` so Back does not
    // land on a sign-in form for a session that now exists.
    onSuccess: () => navigate('', { replace: true }),
  });
  const { verifyOtp, isVerifyingOtp } = verifyMutation;

  // Wrong/expired code: clear the boxes and put the cursor back so the user
  // can just retype — the message stays visible until the next attempt.
  const verifyError = verifyMutation.error;
  React.useEffect(() => {
    if (!verifyError) return;
    setCode('');
    requestAnimationFrame(() => otpRef.current?.focus());
  }, [verifyError]);

  const form = useForm<PatientEmailFormValues>({
    resolver: zodResolver(patientEmailFormSchema),
    defaultValues: { email: '' },
  });

  const submitEmail = (values: PatientEmailFormValues) => {
    setEmail(values.email);
    requestOtp({ email: values.email, organizationSlug });
  };

  const submitCode = (nextCode: string) => {
    if (nextCode.length !== OTP_LENGTH || isVerifyingOtp) return;
    verifyOtp({ email, organizationSlug, code: nextCode });
  };

  const resend = () => {
    if (secondsLeft > 0 || isRequestingOtp) return;
    verifyMutation.reset();
    setCode('');
    requestOtp({ email, organizationSlug });
    restartCooldown();
  };

  const backToEmail = () => {
    verifyMutation.reset();
    requestMutation.reset();
    setCode('');
    setStep('email');
  };

  const requestError = requestErrorMessage(requestMutation.error);
  const codeError = verifyErrorMessage(verifyMutation.error);

  if (step === 'email') {
    return (
      <form
        key="email"
        className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
        onSubmit={form.handleSubmit(submitEmail)}
        method="POST"
        noValidate
      >
        <FieldGroup className="gap-6">
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">Sign in</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Access your appointments, forms and documents
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <Controller
              name="email"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Email</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    type="email"
                    placeholder="johndoe@example.com"
                    aria-invalid={fieldState.invalid}
                    autoComplete="email"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            {requestError && (
              <p
                role="alert"
                aria-live="polite"
                className="text-destructive text-sm text-center"
              >
                {requestError}
              </p>
            )}

            <Button type="submit" disabled={isRequestingOtp}>
              {isRequestingOtp ? 'Sending code…' : 'Continue'}
            </Button>
          </div>

          <FieldDescription className="text-center">
            First time? Use the same email your clinic has on file.
          </FieldDescription>
        </FieldGroup>
      </form>
    );
  }

  return (
    <form
      key="code"
      className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
      onSubmit={(event) => {
        event.preventDefault();
        submitCode(code);
      }}
      method="POST"
      noValidate
    >
      <FieldGroup className="gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-muted-foreground text-sm text-balance">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-foreground">{email}</span>
          </p>
        </div>

        <Field>
          <OtpInput
            ref={otpRef}
            value={code}
            onChange={setCode}
            onComplete={submitCode}
            disabled={isVerifyingOtp}
            invalid={Boolean(codeError)}
            autoFocus
          />
          {/* Reserved space so the error doesn't shift the boxes */}
          <div className="min-h-5 text-center" aria-live="polite">
            {isVerifyingOtp ? (
              <p className="text-muted-foreground text-sm">Signing in…</p>
            ) : (
              codeError && (
                <p role="alert" className="text-destructive text-sm">
                  {codeError}
                </p>
              )
            )}
          </div>
        </Field>

        <Field>
          <FieldDescription className="text-center">
            Didn't get it?{' '}
            {secondsLeft > 0 ? (
              <span className="tabular-nums">
                Resend code in {secondsLeft}s
              </span>
            ) : (
              <button
                type="button"
                onClick={resend}
                disabled={isRequestingOtp}
                className="underline underline-offset-4 disabled:opacity-50"
              >
                {isRequestingOtp ? 'Sending…' : 'Resend code'}
              </button>
            )}
          </FieldDescription>
        </Field>

        <Field>
          <FieldDescription className="text-center">
            <button
              type="button"
              onClick={backToEmail}
              className="underline underline-offset-4"
            >
              Use a different email
            </button>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}

export function PortalSignInIsland({ ctx }: { ctx: PortalContext }) {
  return (
    <PortalProvider ctx={ctx}>
      <PortalAuthLayout>
        <SignInForm organizationSlug={ctx.organizationSlug} />
      </PortalAuthLayout>
    </PortalProvider>
  );
}
