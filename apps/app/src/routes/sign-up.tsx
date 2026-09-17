import {
  type SignUpInput,
  signUpSchema,
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
import { useSignUp } from '@/features/auth/use-sign-up';
import { getPostAuthRedirect } from '@/lib/auth-landing';
import { ensureSession } from '@/lib/session';

const signUpFormSchema = signUpSchema
  .extend({
    confirmPassword: z.string().min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type SignUpFormInput = z.infer<typeof signUpFormSchema>;

export const Route = createFileRoute('/sign-up')({
  beforeLoad: async () => {
    const session = await ensureSession();
    if (session.user) {
      const next = await getPostAuthRedirect(session);
      if (next) throw redirect({ to: next });
    }
  },
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const { signUp, isSigningUp } = useSignUp({
    onSuccess: () => {
      // The legacy multi-step wizard is the live onboarding flow. The
      // Claire-guided Typeform flow at /welcome is built and reachable, but is
      // NOT yet the default — flip this (and the verify-email redirect) to
      // '/welcome' to switch over. See routes/welcome/.
      navigate({ to: '/onboarding' });
    },
  });

  const form = useForm<SignUpFormInput>({
    resolver: zodResolver(signUpFormSchema),
    defaultValues: {
      email: '',
      name: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = (values: SignUpFormInput) => {
    const { confirmPassword: _confirm, ...input } = values;
    signUp(input as SignUpInput);
  };

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
            <h1 className="text-2xl font-bold">Sign up for an account</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Enter your email below to sign up
            </p>
          </div>

          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1">
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  type="text"
                  placeholder="John Doe"
                  aria-invalid={fieldState.invalid}
                  autoComplete="name"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            name="email"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1">
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
              <Field data-invalid={fieldState.invalid} className="gap-1">
                <FieldLabel htmlFor={field.name}>Password</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="•••••••••••"
                  aria-invalid={fieldState.invalid}
                  autoComplete="new-password"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            name="confirmPassword"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1">
                <FieldLabel htmlFor={field.name}>Confirm Password</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  type="password"
                  placeholder="•••••••••••"
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
            <Button type="submit" disabled={isSigningUp}>
              {isSigningUp ? 'Signing up...' : 'Sign up'}
            </Button>
          </Field>

          <Field>
            <FieldDescription className="text-center">
              Already have an account?{' '}
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
