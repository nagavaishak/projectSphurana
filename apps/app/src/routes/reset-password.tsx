import {
  type ResetPasswordInput,
  resetPasswordSchema,
} from '@borradh-workspace/features/auth/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

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
import { useResetPassword } from '@/features/auth/use-reset-password';
import { getPostAuthRedirect } from '@/lib/auth-landing';
import { ensureSession } from '@/lib/session';

const resetPasswordSearchSchema = z.object({
  token: z.string().optional(),
  error: z.string().optional(),
});

export const Route = createFileRoute('/reset-password')({
  validateSearch: resetPasswordSearchSchema,
  beforeLoad: async ({ search }) => {
    // A reset link carries a one-time token and is an explicit intent to
    // change credentials, so it must render even for a signed-in user.
    //
    // This route used to be treated as a plain "public auth page" like
    // /sign-in, bouncing anyone with a session to /dashboard/home. But a live
    // session is NOT evidence the user knows their password: better-auth's
    // changePassword leaves the current session intact, so the phone someone
    // reads their email on stays signed in while they are locked out
    // everywhere else. Clicking the emailed link on that device silently
    // landed them on the dashboard — the form never rendered, so they could
    // not submit even once. A real customer spent a month reporting that
    // reset links "did nothing" for exactly this reason.
    //
    // `error` gets the same pass so an expired link shows the invalid-link
    // screen instead of vanishing into the same silent redirect.
    if (search.token || search.error) return;

    const session = await ensureSession();
    if (session.user) {
      const next = await getPostAuthRedirect(session);
      if (next) throw redirect({ to: next });
    }
  },
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { token, error } = Route.useSearch();
  const { resetPassword, isSubmitting, isSuccess } = useResetPassword({
    onSuccess: () => {
      // Stay on the success view; user clicks "Sign in" link from there.
    },
  });

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: token ?? '',
      newPassword: '',
    },
  });

  if (error === 'INVALID_TOKEN' || !token) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-2xl font-bold">Invalid or expired link</h1>
          <p className="text-muted-foreground text-sm text-balance">
            This password reset link is invalid or has expired. Please request a
            new one.
          </p>
          <Link
            to="/forgot-password"
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Request new reset link
          </Link>
        </div>
      </AuthLayout>
    );
  }

  if (isSuccess) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-2xl font-bold">Password reset</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Your password has been reset successfully. You can now sign in with
            your new password.
          </p>
          <button
            type="button"
            onClick={() => navigate({ to: '/sign-in' })}
            className="text-sm underline underline-offset-4 hover:text-primary"
          >
            Sign in
          </button>
        </div>
      </AuthLayout>
    );
  }

  const onSubmit = (values: ResetPasswordInput) => resetPassword(values);

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
            <h1 className="text-2xl font-bold">Set new password</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Enter your new password below
            </p>
          </div>

          <Controller
            name="newPassword"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>New Password</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="Minimum 8 characters"
                  aria-invalid={fieldState.invalid}
                  autoComplete="new-password"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Resetting...' : 'Reset password'}
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
