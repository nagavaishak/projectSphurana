import { Capacitor } from '@capacitor/core';
import { Smartphone } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  type CapgoStatus,
  getCapgoStatus,
  resetCapgoChannel,
  switchCapgoChannel,
} from '@/lib/capgo';

/**
 * Inspect and switch this device's Capgo OTA channel — used by internal
 * testers to pull a specific PR's JS bundle (`pr-<N>`) onto a device.
 *
 * Channel switching is blocked on production builds (App Store binaries);
 * there, assign the device to a channel from the Capgo dashboard using the
 * Device ID shown below.
 */
export function CapgoDebugCard() {
  const [status, setStatus] = useState<CapgoStatus | null>(null);
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getCapgoStatus().then(setStatus);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const run = async (action: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(ok);
      refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isNative = Capacitor.isNativePlatform();
  const canSwitch = !!status?.isNative && !status.isProductionBuild;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Smartphone className="size-5" />
          <CardTitle>Mobile OTA (Capgo)</CardTitle>
        </div>
        <CardDescription>
          Inspect and switch this device's Capgo update channel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!isNative && (
          <Alert>
            <AlertDescription>
              Capgo OTA only runs in the native app — open this page in the
              Borradh iOS/Android app.
            </AlertDescription>
          </Alert>
        )}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Channel</dt>
          {/*
           * `id` (not data-testid) on these two: the Maestro flows drive this
           * app through the Chrome DevTools driver, where `id:` matches the
           * HTML id attribute. `.maestro/ota/09-ota-applied.yaml` reads
           * `capgo-bundle` to prove the running bundle is the OTA'd one and
           * not the APK's baked copy — without that assertion the flow passes
           * green on the builtin bundle and tests nothing.
           */}
          <dd id="capgo-channel">
            <Badge variant="outline">
              {status?.currentChannel ?? 'default'}
            </Badge>
          </dd>
          <dt className="text-muted-foreground">Bundle</dt>
          <dd className="font-mono text-xs" id="capgo-bundle">
            {status?.currentVersion ?? 'builtin'}
          </dd>
          <dt className="text-muted-foreground">Device ID</dt>
          <dd className="select-all break-all font-mono text-xs">
            {status?.deviceId ?? '—'}
          </dd>
        </dl>

        {isNative && (
          <p className="text-xs text-muted-foreground">
            Find this device in the Capgo dashboard by the Device ID above.
          </p>
        )}

        <div className="flex gap-2">
          <Input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder="channel, e.g. pr-412"
            disabled={!canSwitch || busy}
          />
          <Button
            onClick={() =>
              run(
                () => switchCapgoChannel(channel.trim()),
                `Switched to "${channel.trim()}". Fully quit and reopen the app to load its bundle.`
              )
            }
            disabled={!canSwitch || busy || !channel.trim()}
          >
            Switch
          </Button>
        </div>

        {isNative && status?.isProductionBuild && (
          <Alert>
            <AlertDescription>
              Channel switching is disabled on production builds. Assign this
              device to a channel from the Capgo dashboard using the Device ID
              above.
            </AlertDescription>
          </Alert>
        )}

        <Button
          variant="outline"
          onClick={() =>
            run(
              resetCapgoChannel,
              'Reset to the default channel. Quit and reopen the app to apply.'
            )
          }
          disabled={!status?.isNative || busy}
          className="w-full justify-start"
        >
          Reset to default channel
        </Button>

        {message && <p className="text-sm text-muted-foreground">{message}</p>}
      </CardContent>
    </Card>
  );
}
