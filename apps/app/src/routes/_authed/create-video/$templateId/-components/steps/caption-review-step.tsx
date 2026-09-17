import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useTranscribeVideo } from '@/features/videos';
import { AlertCircleIcon, CaptionsIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useVideoCreation } from '../../-context';
import type { VideoFormData } from '../../-schema';

interface CaptionReviewStepProps {
  form: UseFormReturn<VideoFormData>;
}

export function CaptionReviewStep({ form }: CaptionReviewStepProps) {
  const { draftVideoId } = useVideoCreation();
  const transcriptionTriggeredRef = useRef(false);

  const { transcribeAsync, isTranscribing, isError } = useTranscribeVideo();

  const editedCaptionText = form.watch('editedCaptionText');

  // Trigger transcription on mount if no text already loaded
  useEffect(() => {
    if (transcriptionTriggeredRef.current) return;
    if (!draftVideoId) return;
    // If user already edited text (navigated back), skip transcription
    if (editedCaptionText) return;

    transcriptionTriggeredRef.current = true;

    transcribeAsync(draftVideoId)
      .then((data) => {
        // Only set if user hasn't already started editing
        const currentValue = form.getValues('editedCaptionText');
        if (!currentValue) {
          form.setValue('editedCaptionText', data.text, {
            shouldDirty: true,
          });
        }
      })
      .catch(() => {
        // Error handled by hook toast
      });
  }, [draftVideoId, editedCaptionText, transcribeAsync, form]);

  const charCount = editedCaptionText?.length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <CaptionsIcon className="h-5 w-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">Review Your Captions</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          We transcribed your video automatically. Fix any errors before they
          appear in your video.
        </p>
      </div>

      {/* Transcription area */}
      {isTranscribing ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            Transcribing your video...
          </div>
          <Skeleton className="h-48 w-full rounded-lg" />
        </div>
      ) : isError && !editedCaptionText ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircleIcon className="h-4 w-4 shrink-0" />
          <p>
            Transcription failed. You can type your captions manually or skip
            this step.
          </p>
        </div>
      ) : (
        <Controller
          name="editedCaptionText"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-col gap-2">
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="Your video transcript will appear here..."
                rows={8}
                className="resize-y text-base leading-relaxed"
              />
              <p className="text-xs text-muted-foreground">
                {charCount} characters
              </p>
            </div>
          )}
        />
      )}
    </div>
  );
}
