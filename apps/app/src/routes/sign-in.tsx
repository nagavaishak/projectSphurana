import {
  type SignInInput,
  signInSchema,
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
import { useSignIn } from '@/features/auth/use-sign-in';
import { getPostAuthRedirect } from '@/lib/auth-landing';
import { normalizePostAuthRedirect } from '@/lib/auth-redirect';
import { ensureSession } from '@/lib/session';

const signInSearchSchema = z.object({
  redirect: z.string().optional(),
  /** Next web uses `redirectTo`; accept both for deep-link parity */
  redirectTo: z.string().optional(),
  reason: z.string().optional(),
});

/**
 * Landings that mean "this user is not done onboarding yet" — these always win
 * over a `?redirect=` deep link. `/dashboard/home` and `/billing` are ordinary
 * landings: no protected route gates on them, so an explicit target wins.
 */
const ONBOARDING_LANDINGS = new Set([
  '/welcome',
  '/onboarding',
  '/accept-invitation',
]);

export const Route = createFileRoute('/sign-in')({
  validateSearch: signInSearchSchema,
  beforeLoad: async ({ search }) => {
    const session = await ensureSession();
    if (!session.user) return;

    const next = await getPostAuthRedirect(session);
    if (!next) return;

    // An already-signed-in user reaches /sign-in when `ensureSession()` failed
    // transiently on a protected route (a slow/erroring `auth/session` reads as
    // signed out) and `_authed` bounced them here with their target in
    // `?redirect=`. Send them back to it rather than to the generic landing.
    const requested = search.redirect ?? search.redirectTo;
    if (requested && !ONBOARDING_LANDINGS.has(next)) {
      throw redirect({
        to: normalizePostAuthRedirect(requested, next) as never,
      });
    }

    throw redirect({ to: next });
  },
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();

  const { signIn, isSigningIn } = useSignIn({
    onSuccess: () => {
      const raw = search.redirect ?? search.redirectTo;
      const target = normalizePostAuthRedirect(raw, '/dashboard/home') as never;
      navigate({ to: target, replace: true });
    },
    onTwoFactorRequired: () => {
      const params: { redirect?: string; redirectTo?: string } = {};
      const r = search.redirect ?? search.redirectTo;
      if (r) {
        params.redirect = r;
      }
      navigate({ to: '/verify-2fa', search: params });
    },
  });

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (values: SignInInput) => signIn(values);

  return (
    <AuthLayout>
      <title>Sign In | Borradh</title>
      <form
        className="flex flex-col gap-6"
        onSubmit={form.handleSubmit(onSubmit)}
        method="POST"
        noValidate
      >
        <FieldGroup>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">Sign in to your account</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Enter your email below to sign in
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

          <Controller
            name="password"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <div className="flex items-center">
                  <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                  <Link
                    to="/forgot-password"
                    className="ml-auto text-sm underline-offset-4 hover:underline"
                  >
                    Forgot your password?
                  </Link>
                </div>
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="•••••••••••"
                  aria-invalid={fieldState.invalid}
                  autoComplete="current-password"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Field>
            <Button type="submit" disabled={isSigningIn}>
              {isSigningIn ? 'Signing in...' : 'Sign in'}
            </Button>
          </Field>

          <Field>
            <FieldDescription className="text-center">
              Don't have an account?{' '}
              <Link to="/sign-up" className="underline underline-offset-4">
                Sign up
              </Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </form>
    </AuthLayout>
  );
}
