import { QRCode } from '@/components/kibo-ui/qr-code';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  useCreateMobileToken,
  useMobileUploadStatus,
  useUploadVideo,
} from '@/features/upload/api';
import { useGetVideo } from '@/features/videos';
import { webAppUrl } from '@/lib/web-app-origin';
import {
  CheckCircle2Icon,
  MonitorIcon,
  UploadIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import { type ChangeEvent, useEffect, useRef } from 'react';
import { useVideoCreation } from '../../-context';

export function UploadTalkingHeadQRPreview() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const {
    talkingHeadUrl,
    setTalkingHeadUrl,
    isUploading,
    setIsUploading,
    uploadProgress,
    setUploadProgress,
    draftVideoId,
    generatedScript,
    setHasMobileUpload,
  } = useVideoCreation();

  const hasUploadedVideo = !!talkingHeadUrl;

  // Poll video for talkingHeadUrl set by the recording tab
  const shouldPoll = !!draftVideoId && !hasUploadedVideo && !isUploading;
  const { video } = useGetVideo(draftVideoId ?? '', {
    enabled: shouldPoll,
    refetchInterval: shouldPoll ? 2000 : false,
  });

  useEffect(() => {
    if (!video?.draftConfig || hasUploadedVideo) return;
    const config = video.draftConfig as Record<string, unknown>;
    const url = config.talkingHeadUrl;
    if (typeof url === 'string' && url) {
      setTalkingHeadUrl(url);
    }
  }, [video, hasUploadedVideo, setTalkingHeadUrl]);

  // Mobile magic-link hand-off. Mint a scoped upload token (carrying the
  // script) and encode it into a universal link to the record screen. Scanning
  // opens the native app if installed (universal-link association on
  // app.borradh.io) or the web recorder otherwise; the token authorizes the
  // upload with no phone login. Completion arrives via the mobile-status poll.
  const { createToken, tokenData, isCreating } = useCreateMobileToken();
  const mobileToken = tokenData?.token ?? null;

  useEffect(() => {
    if (draftVideoId && generatedScript && !tokenData && !isCreating) {
      createToken({ videoId: draftVideoId, scriptText: generatedScript });
    }
  }, [draftVideoId, generatedScript, tokenData, isCreating, createToken]);

  // Only poll once a token exists (before that the status key isn't set).
  const { status: mobileStatus, url: mobileUrl } = useMobileUploadStatus(
    tokenData ? (draftVideoId ?? null) : null
  );

  useEffect(() => {
    if (mobileStatus === 'completed' && mobileUrl && !hasUploadedVideo) {
      setTalkingHeadUrl(mobileUrl);
      setHasMobileUpload(true);
    }
  }, [
    mobileStatus,
    mobileUrl,
    hasUploadedVideo,
    setTalkingHeadUrl,
    setHasMobileUpload,
  ]);

  // `webAppUrl`, not `window.location.origin`: this link is carried to a SECOND
  // device by QR. Inside the Capacitor WebView the raw origin is
  // `capacitor://localhost`, which encodes fine and scans to nothing.
  const recordMagicLink =
    draftVideoId && mobileToken
      ? webAppUrl(`/record/${draftVideoId}?uploadToken=${mobileToken}`)
      : null;

  const { upload } = useUploadVideo({
    onProgress: (progress) => {
      setUploadProgress(progress);
    },
    onSuccess: (result) => {
      setTalkingHeadUrl(result.url);
      setIsUploading(false);
      setUploadProgress(0);
    },
    onError: () => {
      setIsUploading(false);
      setUploadProgress(0);
    },
  });

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setIsUploading(true);
      upload(file);
    }
  };

  const handleRemoveVideo = () => {
    setTalkingHeadUrl('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <Card className="w-full max-w-sm gap-2">
      <CardHeader>
        <CardTitle>Upload your recorded video</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {hasUploadedVideo ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between p-3 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center gap-2">
                <VideoIcon className="h-5 w-5 text-green-600" />
                <span className="text-sm font-medium text-green-700 dark:text-green-300">
                  Video uploaded
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRemoveVideo}
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              >
                <XIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : isUploading ? (
          <div className="flex flex-col gap-2 p-3 border rounded-lg">
            <div className="flex items-center gap-2">
              <UploadIcon className="h-4 w-4 animate-pulse" />
              <span className="text-sm text-muted-foreground">
                Uploading...
              </span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
            <span className="text-xs text-muted-foreground text-right">
              {uploadProgress}%
            </span>
          </div>
        ) : (
          <div className="relative">
            <Input
              ref={fileInputRef}
              className="text-muted-foreground cursor-pointer"
              type="file"
              accept="video/*"
              onChange={handleFileChange}
            />
          </div>
        )}

        {/* Record on this device (web teleprompter) */}
        {draftVideoId && !hasUploadedVideo && !isUploading && (
          <Button
            variant="outline"
            className="w-full"
            onClick={() => window.open(`/record/${draftVideoId}`, '_blank')}
          >
            <MonitorIcon className="mr-2 h-4 w-4" />
            Record on this device
          </Button>
        )}

        {/* Record on your phone via QR. This opens the same web teleprompter
            (`/record/:id`) in the phone's browser — no native app needed — and
            the recording uploads back to the draft. The poll above then picks
            up talkingHeadUrl and flips this panel to the uploaded state, so no
            separate "uploaded from phone" branch is needed. The native-app
            deep-link path (mobile upload token, above) stays disabled until the
            mobile app ships. */}
        {draftVideoId && !hasUploadedVideo && !isUploading && (
          <>
            <div className="flex flex-row gap-2 items-center">
              <Separator className="flex-1" orientation="horizontal" />
              <span className="text-muted-foreground text-sm">
                Or, record on your phone
              </span>
              <Separator className="flex-1" orientation="horizontal" />
            </div>
            <div className="flex flex-col items-center gap-2">
              {recordMagicLink ? (
                <QRCode className="size-40" data={recordMagicLink} />
              ) : (
                <div className="flex size-40 items-center justify-center rounded-lg border border-dashed">
                  <span className="text-muted-foreground text-xs">
                    Preparing link…
                  </span>
                </div>
              )}
              <span className="text-muted-foreground text-sm">
                Scan to open the app and record — no sign-in needed
              </span>
            </div>
          </>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-row gap-2">
            <CheckCircle2Icon className="h-5 w-5 text-green-600" />
            <span className="text-foreground text-sm font-medium">
              Record with our built-in teleprompter
            </span>
          </div>
          <div className="flex flex-row gap-2">
            <CheckCircle2Icon className="h-5 w-5 text-green-600" />
            <span className="text-foreground text-sm font-medium">
              Uploads automatically to this page
            </span>
          </div>
        </div>
        {/* TODO: Re-enable app store badges when mobile app is ready */}
        {/* <div className="flex flex-row items-center gap-2">
          <Image
            src="/google-play-badge.png"
            alt="Get it on Google Play"
            width={646}
            height={250}
            className="h-14 w-auto"
          />
          <Image
            src="/app-store-badge.png"
            alt="Download on the App Store"
            width={320}
            height={108}
            className="h-10 w-auto"
          />
        </div> */}
      </CardContent>
    </Card>
  );
}
