import { Smartphone } from 'lucide-react';

import { QRCode } from '@/components/kibo-ui/qr-code';
import { webAppUrl } from '@/lib/web-app-origin';

interface QRCodeCardProps {
  recordingUrl: string;
  instructions?: string;
}

export function QRCodeCard({ recordingUrl, instructions }: QRCodeCardProps) {
  // The server builds recordingUrl from APP_URL, which is unset on previews
  // (per-PR SPA host is a random *.vercel.app the API can't know) — yielding a
  // host-less "/record/:id". A path-only QR is unscannable, so resolve it
  // against the app's public origin here in the browser.
  //
  // `webAppUrl`, not `window.location.origin`: this URL is scanned by a SECOND
  // device. In the Capacitor WebView the raw origin is `capacitor://localhost`,
  // which encodes into a perfectly valid QR that no phone on earth can open.
  const scanUrl = recordingUrl.startsWith('/')
    ? webAppUrl(recordingUrl)
    : recordingUrl;

  return (
    <div className="w-full rounded-lg border bg-card p-4 sm:max-w-xs">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Smartphone className="size-4" />
        Scan to record on mobile
      </div>

      <div className="mx-auto mt-3 size-40 rounded-md bg-white p-2">
        <QRCode
          data={scanUrl}
          robustness="M"
          foreground="oklch(0 0 0)"
          background="oklch(1 0 0)"
        />
      </div>

      {instructions && (
        <p className="mt-3 text-xs text-muted-foreground">{instructions}</p>
      )}

      <p className="mt-2 text-xs text-muted-foreground italic">
        Or drag &amp; drop your video file in the chat.
      </p>
    </div>
  );
}
