import {
  type ForgotPasswordInput,
  forgotPasswordSchema,
} from '@borradh-workspace/features/auth/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useForgotPassword } from '@/features/auth/use-forgot-password';

export const Route = createFileRoute('/forgot-password')({
  // Password RECOVERY must stay reachable while signed in. Being signed in on
  // one device says nothing about whether you know your password — see the
  // note on /reset-password's guard. Redirecting a session-holder away from
  // recovery left them with no route back into their own account.
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  // The address the request was actually sent for. The confirmation echoes it
  // back verbatim: the single most common cause of a "reset email never
  // arrived" report is a customer entering an address that has no account
  // (a business alias, an old address, a typo). We cannot say "no account
  // exists" without leaking which addresses are registered, but we can show
  // WHICH address we acted on, which makes the mistake self-evident.
  const [submittedEmail, setSubmittedEmail] = useState('');
  const { forgotPassword, isSubmitting, isSuccess, reset } =
    useForgotPassword();

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = (values: ForgotPasswordInput) => {
    setSubmittedEmail(values.email);
    forgotPassword(values);
  };

  if (isSuccess) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-muted-foreground text-sm text-balance">
            If an account exists for{' '}
            <span className="text-foreground font-medium break-all">
              {submittedEmail}
            </span>
            , we've sent a password reset link. Check your inbox and spam
            folder.
          </p>
          <p className="text-muted-foreground text-sm text-balance">
            The link expires in 1 hour.
          </p>
          <button
            type="button"
            onClick={() => {
              reset();
              form.reset({ email: submittedEmail });
            }}
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Not the right email? Try another
          </button>
          <Link
            to="/sign-in"
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Back to sign in
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <form
        className="flex flex-col gap-6"
        onSubmit={form.handleSubmit(onSubmit)}
        method="POST"
        noValidate
      >
        <FieldGroup>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">Forgot your password?</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Enter your email and we'll send you a reset link
            </p>
          </div>

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

          <Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Sending...' : 'Send reset link'}
            </Button>
          </Field>

          <Field>
            <FieldDescription className="text-center">
              Remember your password?{' '}
              <Link to="/sign-in" className="underline underline-offset-4">
                Sign in
              </Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
