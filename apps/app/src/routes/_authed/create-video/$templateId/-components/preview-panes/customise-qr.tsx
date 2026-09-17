import { QRCode } from '@/components/kibo-ui/qr-code';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2Icon } from 'lucide-react';

export function CustomiseQRPreview() {
  return (
    <Card className="w-full max-w-sm gap-2">
      <CardHeader>
        <CardTitle>Upload your background videos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <QRCode className="px-15" data="https://www.haydenbleasel.com/" />
        <div className="flex flex-col gap-2">
          <div className="flex flex-row gap-2">
            <CheckCircle2Icon />
            <span className="text-foreground text-sm font-medium">
              Upload directly from your phone on our app
            </span>
          </div>
          <div className="flex flex-row gap-2">
            <CheckCircle2Icon />
            <span className="text-foreground text-sm font-medium">
              Record videos with our teleprompter
            </span>
          </div>
        </div>
        <div className="flex flex-row items-center gap-2">
          <img
            src="/google-play-badge.png"
            alt="Get it on Google Play"
            width={646}
            height={250}
            className="h-14 w-auto"
          />
          <img
            src="/app-store-badge.png"
            alt="Download on the App Store"
            width={320}
            height={108}
            className="h-10 w-auto"
          />
        </div>
      </CardContent>
    </Card>
  );
}
