import { apiClient } from '@borradh-workspace/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { QRCode } from '@/components/kibo-ui/qr-code';
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

interface EnableTwoFactorResponse {
  totpURI: string;
  backupCodes: string[];
}

interface TwoFactorSetupProps {
  onSetupComplete: () => void;
}

export function TwoFactorSetup({ onSetupComplete }: TwoFactorSetupProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'password' | 'qr' | 'verify'>('password');
  const [password, setPassword] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verifyCode, setVerifyCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEnable = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await apiClient.post<EnableTwoFactorResponse>(
        'auth/two-factor/enable',
        { password }
      );
      if (result.totpURI) {
        setTotpUri(result.totpURI);
        setBackupCodes(result.backupCodes ?? []);
        setStep('qr');
      }
    } catch {
      setError('Failed to enable 2FA. Check your password.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerify = async () => {
    setIsLoading(true);
    setError('');
    try {
      await apiClient.post('auth/two-factor/verify-totp', {
        code: verifyCode,
      });
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      toast.success('Two-factor authentication enabled');
      onSetupComplete();
    } catch {
      setError('Invalid verification code');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
            <ShieldCheck className="text-primary h-6 w-6" />
          </div>
          <CardTitle>Set Up Two-Factor Authentication</CardTitle>
          <CardDescription>
            Admin access requires 2FA. Set it up to continue.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'password' && (
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="password">
                  Enter your password to begin
                </FieldLabel>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your account password"
                  onKeyDown={(e) => e.key === 'Enter' && handleEnable()}
                />
                {error && <FieldError errors={[{ message: error }]} />}
              </Field>
              <Button
                onClick={handleEnable}
                disabled={!password || isLoading}
                className="w-full"
              >
                {isLoading ? 'Enabling...' : 'Enable 2FA'}
              </Button>
            </div>
          )}

          {step === 'qr' && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Scan this QR code with your authenticator app (Google
                Authenticator, Authy, etc.)
              </p>
              <div className="flex justify-center">
                <div className="h-48 w-48">
                  <QRCode data={totpUri} robustness="M" />
                </div>
              </div>
              {backupCodes.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Backup Codes</p>
                  <p className="text-muted-foreground text-xs">
                    Save these codes in a safe place. You can use them if you
                    lose access to your authenticator.
                  </p>
                  <div className="bg-muted grid grid-cols-2 gap-1 rounded-md p-3 font-mono text-xs">
                    {backupCodes.map((code) => (
                      <span key={code}>{code}</span>
                    ))}
                  </div>
                </div>
              )}
              <Button onClick={() => setStep('verify')} className="w-full">
                I&apos;ve scanned the code
              </Button>
            </div>
          )}

          {step === 'verify' && (
            <div className="space-y-4">
              <Field>
                <FieldLabel htmlFor="verify-code">
                  Enter the 6-digit code from your authenticator
                </FieldLabel>
                <Input
                  id="verify-code"
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) =>
                    setVerifyCode(e.target.value.replace(/\D/g, ''))
                  }
                  placeholder="000000"
                  className="text-center font-mono text-lg tracking-widest"
                  onKeyDown={(e) =>
                    e.key === 'Enter' &&
                    verifyCode.length === 6 &&
                    handleVerify()
                  }
                />
                {error && <FieldError errors={[{ message: error }]} />}
              </Field>
              <Button
                onClick={handleVerify}
                disabled={verifyCode.length !== 6 || isLoading}
                className="w-full"
              >
                {isLoading ? 'Verifying...' : 'Verify & Complete Setup'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
