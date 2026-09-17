import { ApiClientError, apiClient } from '@borradh-workspace/api-client';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

interface TwoFactorVerifyProps {
  onVerified: () => void;
}

/**
 * Turn a verify-2fa failure into something that points at the real cause.
 *
 * Rate limiting deserves its own message above all: retrying is exactly the
 * wrong response to a 429, and "invalid code" invites precisely that.
 */
function describeVerifyFailure(err: unknown): string {
  if (err instanceof ApiClientError) {
    if (err.status === 429) {
      return 'Too many attempts. Wait a few minutes before trying again.';
    }
    if (err.status === 401 && err.message && !/invalid/i.test(err.message)) {
      return err.message;
    }
    if (err.status >= 500) {
      return 'Verification is unavailable right now. Try again shortly.';
    }
  }
  return 'Invalid code. Please try again.';
}

export function TwoFactorVerify({ onVerified }: TwoFactorVerifyProps) {
  const [code, setCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVerify = async () => {
    setIsLoading(true);
    setError('');
    try {
      await apiClient.post('admin-terminal/verify-2fa', { code });
      onVerified();
    } catch (err) {
      // A bare catch here used to render "Invalid code" for EVERY failure —
      // including a 429 from the 5-per-15-min throttle and the 401 raised when
      // the forwarded session belongs to someone else. Both were reported as
      // "it keeps saying invalid code" while the API logged something else
      // entirely, and the screen actively pointed away from the real cause.
      setError(describeVerifyFailure(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
            <KeyRound className="text-primary h-6 w-6" />
          </div>
          <CardTitle>Admin Verification</CardTitle>
          <CardDescription>
            Enter your authenticator code to access the admin terminal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Field>
              <FieldLabel htmlFor="totp-code">6-digit code</FieldLabel>
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
                onKeyDown={(e) =>
                  e.key === 'Enter' && code.length === 6 && handleVerify()
                }
              />
              {error && <FieldError errors={[{ message: error }]} />}
            </Field>
            <Button
              onClick={handleVerify}
              disabled={code.length !== 6 || isLoading}
              className="w-full"
            >
              {isLoading ? 'Verifying...' : 'Verify'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
