import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
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
import { useVerifyTotp } from '@/features/auth/use-verify-2fa';
import { normalizePostAuthRedirect } from '@/lib/auth-redirect';

const verify2faSearchSchema = z.object({
  redirect: z.string().optional(),
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute('/verify-2fa')({
  validateSearch: verify2faSearchSchema,
  component: Verify2faPage,
});

function Verify2faPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const { verifyTotp, isVerifying } = useVerifyTotp({
    onSuccess: () => {
      const raw = search.redirect ?? search.redirectTo;
      const target = normalizePostAuthRedirect(raw, '/dashboard/home') as never;
      navigate({ to: target, replace: true });
    },
    onError: (e) => setError(e.message || 'Invalid code. Please try again.'),
  });

  const handleVerify = () => {
    if (code.length !== 6) return;
    setError('');
    verifyTotp({ code });
  };

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <FieldGroup>
          <div className="flex flex-col items-center gap-1 text-center">
            <h1 className="text-2xl font-bold">Two-factor verification</h1>
            <p className="text-muted-foreground text-sm text-balance">
              Enter the 6-digit code from your authenticator app
            </p>
          </div>

          <Field>
            <FieldLabel htmlFor="totp-code">Verification code</FieldLabel>
            <Input
              id="totp-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="text-center font-mono text-lg tracking-widest"
              autoFocus
              autoComplete="one-time-code"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) handleVerify();
              }}
            />
            {error && <FieldError errors={[{ message: error }]} />}
          </Field>

          <Field>
            <Button
              type="button"
              onClick={handleVerify}
              disabled={code.length !== 6 || isVerifying}
              className="w-full"
            >
              {isVerifying ? 'Verifying...' : 'Verify'}
            </Button>
          </Field>

          <Field>
            <FieldDescription className="text-center">
              <Link to="/sign-in" className="underline underline-offset-4">
                Back to sign in
              </Link>
            </FieldDescription>
          </Field>
        </FieldGroup>
      </div>
    </AuthLayout>
  );
}
