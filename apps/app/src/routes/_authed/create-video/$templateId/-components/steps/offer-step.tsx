import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type GeneratedOfferCopy,
  useGenerateOfferCopy,
} from '@/features/ai-content';
import { OfferFormDialog, useListOffers } from '@/features/offers';
import type { Offer } from '@borradh-workspace/api-client/types';
import { Loader2Icon, PlusIcon, TagIcon } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import type { VideoFormData } from '../../-schema';

interface OfferStepProps {
  form: UseFormReturn<VideoFormData>;
}

/**
 * Window 9 — the offer rework dropped headline/ctaText/etc. columns from
 * the offer table. When the user picks an offer in the video flow we now
 * call `POST /ai-content/generate-offer-copy`, which returns the full
 * video-copy bundle (headline + CTA + urgency + audience + bullets). The
 * backend always returns SOMETHING (templated fallback on LLM failure),
 * so the form prefill is unconditional.
 */
export function OfferStep({ form }: OfferStepProps) {
  const serviceId = form.watch('serviceId');
  const selectedOfferId = form.watch('offerId');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { offers, isLoading: isLoadingOffers } = useListOffers({
    state: 'active',
  });

  const applyCopyToForm = useCallback(
    (copy: GeneratedOfferCopy) => {
      form.setValue('offerHeadline', copy.headline, { shouldValidate: true });
      form.setValue('ctaText', copy.ctaText || 'Book now', {
        shouldValidate: true,
      });
      form.setValue('urgencyText', copy.urgencyText || '');
      form.setValue('audienceText', copy.audienceText || '');
      form.setValue('bulletPoints', copy.bulletPoints, {
        shouldValidate: true,
      });
    },
    [form]
  );

  const { generateOfferCopyAsync, isGenerating } = useGenerateOfferCopy();

  // Sort: offers linked to current service first, then alphabetically
  const sortedOffers = useMemo(() => {
    if (!offers.length) return [];
    return [...offers].sort((a, b) => {
      const aLinked = serviceId ? a.serviceIds.includes(serviceId) : false;
      const bLinked = serviceId ? b.serviceIds.includes(serviceId) : false;
      if (aLinked && !bLinked) return -1;
      if (!aLinked && bLinked) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [offers, serviceId]);

  const populateFormFromOffer = useCallback(
    async (offer: Offer & { serviceIds: string[] }) => {
      form.setValue('offerId', offer.id);
      // Headline defaults to the offer name while the LLM is generating —
      // keeps the form valid (offerHeadline is required) if the user
      // advances before generation finishes.
      form.setValue('offerHeadline', offer.name, { shouldValidate: true });
      form.setValue('bulletPoints', [], { shouldValidate: true });

      const copy = await generateOfferCopyAsync({ offerId: offer.id });
      applyCopyToForm(copy);
    },
    [form, generateOfferCopyAsync, applyCopyToForm]
  );

  const handleOfferSelect = useCallback(
    (offerId: string) => {
      const offer = offers.find((o) => o.id === offerId);
      if (!offer) return;
      void populateFormFromOffer(offer);
    },
    [offers, populateFormFromOffer]
  );

  const handleOfferCreated = useCallback(
    (offer: Offer & { serviceIds: string[] }) => {
      void populateFormFromOffer(offer);
    },
    [populateFormFromOffer]
  );

  return (
    <div className="space-y-6">
      {/* Offer Selection */}
      <div>
        <h3 className="text-lg font-semibold">Select an Offer</h3>
        <p className="text-sm text-muted-foreground">
          Choose an existing offer or create a new one.
        </p>
      </div>

      {isLoadingOffers ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <>
          {sortedOffers.length > 0 && (
            <RadioGroup
              value={selectedOfferId ?? ''}
              onValueChange={handleOfferSelect}
            >
              {sortedOffers.map((offer) => (
                <FieldLabel key={offer.id}>
                  <Field orientation="horizontal">
                    <RadioGroupItem value={offer.id} />
                    <FieldContent>
                      <FieldTitle>
                        <TagIcon className="size-4" />
                        {offer.name}
                      </FieldTitle>
                      {offer.code && (
                        <FieldDescription>Code: {offer.code}</FieldDescription>
                      )}
                    </FieldContent>
                  </Field>
                </FieldLabel>
              ))}
            </RadioGroup>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() => setCreateDialogOpen(true)}
            className="w-full"
          >
            <PlusIcon className="size-4" />
            Create new offer
          </Button>

          {isGenerating && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />
              Generating offer copy...
            </p>
          )}
        </>
      )}

      <OfferFormDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        lockedServiceIds={serviceId ? [serviceId] : []}
        onOfferSaved={handleOfferCreated}
      />
    </div>
  );
}
