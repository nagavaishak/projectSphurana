import { AiFieldWrapper } from '@/components/ui/ai-field-wrapper';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateVideo } from '@/features/videos';
import {
  aiVoiceIdLabels,
  aiVoiceIdValues,
} from '@borradh-workspace/api-client/types';
import {
  AudioLinesIcon,
  CheckCircle2Icon,
  CheckIcon,
  Loader2Icon,
  MicIcon,
  RefreshCwIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useVideoCreation } from '../../-context';
import type { VideoFormData } from '../../-schema';

interface ScriptStepProps {
  form: UseFormReturn<VideoFormData>;
}

export function ScriptStep({ form }: ScriptStepProps) {
  const {
    selectedVariation,
    supportsAiVoiceover,
    draftVideoId,
    generatedScript,
    isGeneratingScript,
    hasGeneratedScript,
    regenerateScript,
    setNarrationMode,
    talkingHeadUrl,
    isUploading,
    uploadProgress,
    hasMobileUpload,
  } = useVideoCreation();
  const { updateVideoAsync } = useUpdateVideo({ silent: true });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>(
    'idle'
  );
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const appliedScriptRef = useRef(false);

  // Cache scripts per narration mode so switching back restores without regenerating
  const scriptCacheRef = useRef<Record<string, string>>({});

  const scriptText = form.watch('scriptText');
  const narrationType = form.watch('narrationType');

  // Track the previous narration type to detect user-initiated switches
  const prevNarrationTypeRef = useRef(narrationType);

  // Sync narration mode to context so page.tsx can swap preview panes
  // and swap/regenerate script when switching between recorded/ai_voiceover
  useEffect(() => {
    const prev = prevNarrationTypeRef.current;
    prevNarrationTypeRef.current = narrationType;
    setNarrationMode(narrationType || 'recorded');

    // Handle switching between recorded and ai_voiceover
    if (
      prev &&
      prev !== narrationType &&
      hasGeneratedScript &&
      (narrationType === 'recorded' || narrationType === 'ai_voiceover') &&
      (prev === 'recorded' || prev === 'ai_voiceover')
    ) {
      // Save current script under the old mode
      const currentScript = form.getValues('scriptText');
      if (currentScript) {
        scriptCacheRef.current[prev] = currentScript;
      }

      // Check if we have a cached script for the new mode
      const cached = scriptCacheRef.current[narrationType];
      if (cached) {
        // Restore cached script — no regeneration needed
        form.setValue('scriptText', cached, { shouldValidate: true });
      } else {
        // No cached script for this mode — regenerate with explicit mode
        appliedScriptRef.current = false;
        form.setValue('scriptText', '', { shouldValidate: false });
        regenerateScript(narrationType);
      }
    }
  }, [
    narrationType,
    setNarrationMode,
    hasGeneratedScript,
    regenerateScript,
    form,
  ]);

  // Sync talkingHeadUrl from context to form
  useEffect(() => {
    form.setValue('talkingHeadUrl', talkingHeadUrl, {
      shouldValidate: true,
    });
  }, [talkingHeadUrl, form]);

  // Apply generated script to the form when it arrives
  // (caching happens in the mode-switching effect when the user switches away)
  useEffect(() => {
    if (!generatedScript) return;
    const currentValue = form.getValues('scriptText');
    if (!currentValue || !appliedScriptRef.current) {
      form.setValue('scriptText', generatedScript, { shouldValidate: true });
      appliedScriptRef.current = true;
    }
  }, [generatedScript, form]);

  // Fallback: if generation isn't running and we have no script, use raw template
  useEffect(() => {
    if (isGeneratingScript) return;
    if (form.getValues('scriptText')) return;
    if (!hasGeneratedScript && selectedVariation?.scriptTemplate) {
      form.setValue('scriptText', selectedVariation.scriptTemplate, {
        shouldValidate: true,
      });
    }
  }, [isGeneratingScript, hasGeneratedScript, selectedVariation, form]);

  const handleRegenerate = () => {
    appliedScriptRef.current = false;
    regenerateScript();
  };

  // Auto-save script to backend (debounced, only when draft exists)
  const autoSave = useCallback(
    (text: string) => {
      if (!draftVideoId || !text) return;

      setSaveStatus('saving');
      updateVideoAsync({
        id: draftVideoId,
        draftConfig: { scriptText: text },
      })
        .then(() => {
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 2000);
        })
        .catch(() => {
          setSaveStatus('idle');
        });
    },
    [draftVideoId, updateVideoAsync]
  );

  // Watch for script changes and debounce auto-save
  useEffect(() => {
    if (!draftVideoId || !scriptText) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => autoSave(scriptText), 800);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [scriptText, draftVideoId, autoSave]);

  const charCount = scriptText?.length ?? 0;

  return (
    <div
      className="flex flex-col gap-6"
      data-claire-target="create-video-script-step"
    >
      <div>
        <h2 className="text-2xl font-semibold">Edit Your Script</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {narrationType === 'ai_voiceover'
            ? 'This script will be read by the AI voice you select below.'
            : 'This script will appear on the mobile teleprompter when you record.'}
        </p>
      </div>

      {/* Narration type selector (hidden for templates that don't support AI voiceover) */}
      {supportsAiVoiceover && (
        <Controller
          name="narrationType"
          control={form.control}
          render={({ field }) => (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  field.onChange('recorded');
                  // Clear voice selection when switching back
                  form.setValue('aiVoiceId', undefined);
                }}
                className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
                  field.value !== 'ai_voiceover'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <div
                  className={`rounded-full p-2 ${
                    field.value !== 'ai_voiceover'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <MicIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">Record yourself</p>
                  <p className="text-xs text-muted-foreground">
                    Film a talking head video
                  </p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => {
                  field.onChange('ai_voiceover');
                  // Set default voice
                  if (!form.getValues('aiVoiceId')) {
                    form.setValue('aiVoiceId', 'af_heart');
                  }
                }}
                className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
                  field.value === 'ai_voiceover'
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-muted-foreground/50'
                }`}
              >
                <div
                  className={`rounded-full p-2 ${
                    field.value === 'ai_voiceover'
                      ? 'bg-primary/10 text-primary'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <AudioLinesIcon className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium text-sm">AI voiceover</p>
                  <p className="text-xs text-muted-foreground">
                    Generate speech from script
                  </p>
                </div>
              </button>
            </div>
          )}
        />
      )}

      {/* Voice picker (only when AI voiceover selected) */}
      {narrationType === 'ai_voiceover' && (
        <Controller
          name="aiVoiceId"
          control={form.control}
          render={({ field, fieldState }) => (
            <div className="space-y-2">
              <label
                htmlFor="aiVoiceId"
                className="text-sm font-medium leading-none"
              >
                Voice
              </label>
              <select
                id="aiVoiceId"
                value={field.value || ''}
                onChange={(e) => field.onChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-invalid={fieldState.invalid}
              >
                <option value="" disabled>
                  Select a voice...
                </option>
                {aiVoiceIdValues.map((voiceId) => (
                  <option key={voiceId} value={voiceId}>
                    {aiVoiceIdLabels[voiceId]}
                  </option>
                ))}
              </select>
              {fieldState.error && (
                <p className="text-sm text-destructive">
                  {fieldState.error.message}
                </p>
              )}
            </div>
          )}
        />
      )}

      {/* Script textarea with AI shimmer/rainbow border */}
      <AiFieldWrapper
        isGenerating={isGeneratingScript}
        hasGenerated={hasGeneratedScript}
      >
        <Textarea
          placeholder="Write your script here..."
          className="text-base leading-relaxed resize-y min-h-[200px] whitespace-pre-wrap"
          {...form.register('scriptText')}
        />
      </AiFieldWrapper>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <span className="text-xs text-muted-foreground">
          {charCount} characters
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {saveStatus === 'saving' && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Loader2Icon className="h-3 w-3 animate-spin" />
              Saving...
            </span>
          )}
          {saveStatus === 'saved' && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckIcon className="h-3 w-3" />
              Saved
            </span>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleRegenerate}
            disabled={isGeneratingScript}
          >
            <RefreshCwIcon className="h-3.5 w-3.5 mr-1.5" />
            Regenerate
          </Button>
        </div>
      </div>

      {/* Recording/upload status (only for recorded narration) */}
      {narrationType !== 'ai_voiceover' && (
        <>
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

          {talkingHeadUrl && !isUploading && (
            <div className="flex items-center gap-3 p-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20">
              <CheckCircle2Icon className="h-5 w-5 text-green-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  {hasMobileUpload
                    ? 'Video uploaded from mobile app!'
                    : 'Video uploaded successfully!'}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400 mt-0.5">
                  Your video will be transcribed automatically for captions.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
