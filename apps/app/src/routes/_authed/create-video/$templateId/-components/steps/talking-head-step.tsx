import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CheckCircle2Icon, Loader2Icon, UploadIcon } from 'lucide-react';
import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useVideoCreation } from '../../-context';
import type { VideoFormData } from '../../-schema';

interface TalkingHeadStepProps {
  form: UseFormReturn<VideoFormData>;
  /**
   * Desktop renders the QR pane to the right of the form; mobile has no right
   * pane (the user is already on their phone), so the copy changes with it.
   */
  layout?: 'default' | 'mobile';
}

export function TalkingHeadStep({
  form,
  layout = 'default',
}: TalkingHeadStepProps) {
  const { talkingHeadUrl, isUploading, uploadProgress, hasMobileUpload } =
    useVideoCreation();
  const isMobileLayout = layout === 'mobile';

  // Sync context value to form
  useEffect(() => {
    form.setValue('talkingHeadUrl', talkingHeadUrl, {
      shouldValidate: true,
    });
  }, [talkingHeadUrl, form]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Record your video</h2>
        {!talkingHeadUrl && !isUploading && (
          <p className="text-sm text-muted-foreground mt-1">
            {isMobileLayout
              ? 'Record with the teleprompter, or upload a video directly'
              : 'Scan the QR code to record on your phone, or upload a video directly'}
          </p>
        )}
        {hasMobileUpload && (
          <p className="text-sm text-green-600 mt-1 flex items-center gap-1">
            <CheckCircle2Icon className="h-4 w-4" />
            Video uploaded from mobile app!
          </p>
        )}
      </div>

      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>We recommend using our mobile app to record.</AlertTitle>
        <AlertDescription>
          {isMobileLayout
            ? 'Open the teleprompter to record your video. Your speech will be automatically transcribed for captions.'
            : 'Scan the QR code on the right to open the teleprompter and record your video. Your speech will be automatically transcribed for captions.'}
        </AlertDescription>
      </Alert>

      {/* Upload status indicator */}
      {isUploading && (
        <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
          <Loader2Icon className="h-5 w-5 animate-spin text-primary" />
          <div className="flex-1">
            <p className="text-sm font-medium">Uploading video...</p>
            {uploadProgress > 0 && (
              <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upload complete indicator */}
      {talkingHeadUrl && !isUploading && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20">
          <CheckCircle2Icon className="h-5 w-5 text-green-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-green-800 dark:text-green-200">
              Video uploaded successfully!
            </p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
              Your video will be transcribed automatically for captions.
            </p>
          </div>
        </div>
      )}

      {/* Tips section */}
      <div className="rounded-lg border p-4 space-y-3">
        <h3 className="font-medium flex items-center gap-2">
          <UploadIcon className="h-4 w-4" />
          Tips for a great video
        </h3>
        <ul className="text-sm text-muted-foreground space-y-2">
          <li className="flex items-start gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
            Record in a well-lit area with minimal background noise
          </li>
          <li className="flex items-start gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
            Speak clearly and naturally - captions are generated automatically
          </li>
          <li className="flex items-start gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
            Keep videos between 30-90 seconds for best engagement
          </li>
          <li className="flex items-start gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground mt-1.5 shrink-0" />
            Use portrait orientation for TikTok/Reels/Shorts
          </li>
        </ul>
      </div>
    </div>
  );
}
