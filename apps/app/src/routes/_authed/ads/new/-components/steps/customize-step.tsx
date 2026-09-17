import { AiFieldWrapper } from '@/components/ui/ai-field-wrapper';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useGenerateContent } from '@/features/ai-content';
import type { CallToAction } from '@borradh-workspace/api-client/types';
import {
  metaCallToActionLabels,
  metaCallToActionValues,
} from '@borradh-workspace/api-client/types';
import { useEffect, useRef, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { useAdWizard } from '../../-context';
import { type AdWizardFormData, adWizardLabels as L } from '../../-schema';

export function CustomizeStep() {
  const { watch, control, setValue } = useFormContext<AdWizardFormData>();
  const {
    updatePreviewData,
    selectedCampaignFollowUpType,
    selectedVideo,
    isGeneratingContent: isGenerating,
    setIsGeneratingContent: setIsGenerating,
  } = useAdWizard();
  const [hasGenerated, setHasGenerated] = useState(false);
  const generationTriggeredRef = useRef(false);
  const lastServiceIdsRef = useRef<string[]>([]);

  const isLeadForm = selectedCampaignFollowUpType === 'lead_form';
  const isChatbot = selectedCampaignFollowUpType === 'chatbot';
  const showDestinationUrl = !isLeadForm && !isChatbot;

  // Watch form values and update preview
  const headline = watch('headline');
  const primaryText = watch('primaryText');
  const description = watch('description');
  const callToAction = watch('callToAction');
  const serviceIds = watch('serviceIds');

  const { generateContentAsync } = useGenerateContent();

  // Auto-generate content when component mounts with a selected video,
  // or when serviceIds change after initial generation
  useEffect(() => {
    if (!selectedVideo?.id) return;

    const currentServiceIds = serviceIds?.length ? [...serviceIds].sort() : [];
    const lastServiceIds = lastServiceIdsRef.current;
    const serviceIdsChanged =
      generationTriggeredRef.current &&
      (currentServiceIds.length !== lastServiceIds.length ||
        currentServiceIds.some((id, i) => id !== lastServiceIds[i]));

    const shouldGenerate =
      (!generationTriggeredRef.current && !headline && !primaryText) ||
      serviceIdsChanged;

    if (!shouldGenerate) return;

    generationTriggeredRef.current = true;
    lastServiceIdsRef.current = currentServiceIds;
    setIsGenerating(true);
    setHasGenerated(false);

    generateContentAsync({
      mediaType: 'video',
      mediaId: selectedVideo.id,
      contentType: 'ad',
      serviceIds: serviceIds?.length ? serviceIds : undefined,
    })
      .then((data) => {
        if (data.contentType === 'ad') {
          setValue('headline', data.content.headline, {
            shouldValidate: true,
          });
          setValue('primaryText', data.content.primaryText, {
            shouldValidate: true,
          });
          setValue('description', data.content.description, {
            shouldValidate: true,
          });
          if (data.content.callToAction) {
            setValue(
              'callToAction',
              data.content.callToAction as CallToAction,
              { shouldValidate: true }
            );
          }
          setHasGenerated(true);
        }
      })
      .catch(() => {
        // Error toast already shown by useGenerateContent hook
      })
      .finally(() => {
        setIsGenerating(false);
      });
  }, [
    selectedVideo,
    headline,
    primaryText,
    serviceIds,
    generateContentAsync,
    setValue,
    setIsGenerating,
  ]);

  // Seed a sensible default CTA (SIGN_UP) for lead-form campaigns — but only
  // once, so the user can still pick any valid lead CTA (LEARN_MORE, etc.)
  // without it snapping back.
  const leadFormCtaDefaultedRef = useRef(false);
  useEffect(() => {
    if (!isLeadForm || leadFormCtaDefaultedRef.current) return;
    leadFormCtaDefaultedRef.current = true;
    if (callToAction === 'LEARN_MORE') {
      setValue('callToAction', 'SIGN_UP');
    }
  }, [isLeadForm, callToAction, setValue]);

  // Clear destination URL when it's not applicable (lead form / chatbot destinations)
  useEffect(() => {
    if (!showDestinationUrl) {
      setValue('destinationUrl', '');
    }
  }, [showDestinationUrl, setValue]);

  useEffect(() => {
    updatePreviewData({
      headline: headline || '',
      primaryText: primaryText || '',
      description: description || '',
      callToAction: callToAction || 'LEARN_MORE',
    });
  }, [headline, primaryText, description, callToAction, updatePreviewData]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold">Customize your ad</h2>
        <p className="text-muted-foreground mt-1">
          Add compelling copy to make your ad stand out
        </p>
      </div>

      {/* Headline */}
      <FormField
        control={control}
        name="headline"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{L.headline}</FormLabel>
            <AiFieldWrapper
              isGenerating={isGenerating}
              hasGenerated={hasGenerated}
            >
              <FormControl>
                <Input
                  placeholder="Your attention-grabbing headline"
                  maxLength={80}
                  data-claire-target="ads-new-headline-input"
                  {...field}
                />
              </FormControl>
            </AiFieldWrapper>
            <FormDescription>
              {field.value?.length || 0}/80 characters
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Primary Text */}
      <FormField
        control={control}
        name="primaryText"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{L.primaryText}</FormLabel>
            <AiFieldWrapper
              isGenerating={isGenerating}
              hasGenerated={hasGenerated}
            >
              <FormControl>
                <Textarea
                  placeholder="Tell people what your ad is about..."
                  maxLength={500}
                  rows={5}
                  {...field}
                />
              </FormControl>
            </AiFieldWrapper>
            <FormDescription>
              {field.value?.length || 0}/500 characters
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Description */}
      <FormField
        control={control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{L.description}</FormLabel>
            <AiFieldWrapper
              isGenerating={isGenerating}
              hasGenerated={hasGenerated}
            >
              <FormControl>
                <Input
                  placeholder="Short description"
                  maxLength={30}
                  {...field}
                />
              </FormControl>
            </AiFieldWrapper>
            <FormDescription>
              {field.value?.length || 0}/30 characters
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Call to Action — hidden for chatbot campaigns (hardcoded to CONTACT_US
          on the backend). Shown for lead-form and website/traffic ads, where
          the button label is settable. */}
      {!isChatbot && (
        <FormField
          control={control}
          name="callToAction"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.callToAction}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a call to action" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {metaCallToActionValues.map((value: CallToAction) => (
                    <SelectItem key={value} value={value}>
                      {metaCallToActionLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
      )}

      {/* Destination URL — only shown when the ad destination is a website (not lead form or chatbot) */}
      {showDestinationUrl && (
        <FormField
          control={control}
          name="destinationUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{L.destinationUrl}</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  placeholder="https://example.com"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Where people go when they click your ad. Defaults to your
                website.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
    </div>
  );
}
