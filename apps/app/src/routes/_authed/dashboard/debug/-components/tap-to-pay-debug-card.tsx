import { Smartphone } from 'lucide-react';
import { useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  TapToPayButton,
  type TerminalError,
  isTapToPaySupported,
  usesSimulatedReader,
} from '@/features/terminal';

/**
 * Debug harness for the Tap to Pay flow — lets an internal tester drive
 * `TapToPayButton` end-to-end against a PaymentIntent client secret before
 * checkout (agent B2) is merged.
 *
 * In development this runs against Stripe's **simulated reader**, so no
 * physical hardware or Apple entitlement is required. Paste a `card_terminal`
 * PaymentIntent client secret (created on the connected account) and tap.
 */
export function TapToPayDebugCard() {
  const isNative = isTapToPaySupported();
  const isSimulated = usesSimulatedReader();

  const [clientSecret, setClientSecret] = useState('');
  const [locationId, setLocationId] = useState('');
  const [amount, setAmount] = useState('1000');
  const [currency, setCurrency] = useState('eur');
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<'success' | 'error' | null>(null);

  const amountCents = Number.parseInt(amount, 10);
  const canCharge =
    clientSecret.trim().length > 0 && Number.isFinite(amountCents);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Smartphone className="size-5" />
          <CardTitle>Tap to Pay (Stripe Terminal)</CardTitle>
        </div>
        <CardDescription>
          Drive a card_terminal PaymentIntent through Tap to Pay on this device.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isNative && (
          <Alert>
            <AlertDescription>
              Tap to Pay only runs in the native app — open this page in the
              Borradh iOS/Android app.
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Reader</dt>
          <dd>
            <Badge variant="outline">
              {isSimulated ? 'simulated' : 'tap-to-pay'}
            </Badge>
          </dd>
        </dl>

        <div className="space-y-2">
          <Label htmlFor="ttp-secret">PaymentIntent client secret</Label>
          <Input
            id="ttp-secret"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder="pi_..._secret_..."
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-2">
            <Label htmlFor="ttp-amount">Amount (minor units)</Label>
            <Input
              id="ttp-amount"
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="1000"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ttp-currency">Currency</Label>
            <Input
              id="ttp-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              placeholder="eur"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="ttp-location">
            Terminal location id (tml_…, real Tap to Pay only)
          </Label>
          <Input
            id="ttp-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            placeholder="tml_..."
          />
        </div>

        <TapToPayButton
          clientSecret={clientSecret.trim()}
          amount={Number.isFinite(amountCents) ? amountCents : 0}
          currency={currency.trim() || 'eur'}
          locationId={locationId.trim() || undefined}
          disabled={!canCharge}
          onSuccess={() => {
            setStatus('success');
            setMessage('Payment approved.');
          }}
          onError={(err: TerminalError) => {
            setStatus('error');
            setMessage(
              err.declineCode
                ? `Failed: ${err.message} (${err.declineCode})`
                : `Failed: ${err.message}`
            );
          }}
        />

        {message && (
          // Stable assertion target for the `08-tap-to-pay` Maestro flow. The
          // testid is success-specific (a failed charge renders
          // `tap-to-pay-charge-error` instead), so asserting the success id is
          // an unambiguous "charge approved" signal, not just "some result".
          <p
            data-testid={
              status === 'success'
                ? 'tap-to-pay-charge-success'
                : 'tap-to-pay-charge-error'
            }
            className="text-sm text-muted-foreground"
          >
            {message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
