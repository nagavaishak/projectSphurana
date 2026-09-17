import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useListOffers } from '@/features/offers';
import { useListServices } from '@/features/organization-services';
import { createVideoForm } from '@/features/videos/api/create-video';
import {
  type ServiceCategory,
  serviceCategoryLabels,
} from '@borradh-workspace/api-client/types';
import { CheckIcon, SparklesIcon, XIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useVideoCreation } from '../../-context';
import type { VideoFormData } from '../../-schema';

/** Labels come from the form declaration — see `create-video.form`. */
const L = createVideoForm.labels;

interface ServiceStepProps {
  form: UseFormReturn<VideoFormData>;
}

const OFFER_NONE_VALUE = '__none__';

export function ServiceStep({ form }: ServiceStepProps) {
  const serviceId = form.watch('serviceId');
  const offerId = form.watch('offerId');
  const { templateId } = useVideoCreation();
  // The dedicated OfferStep already owns offer selection for offer-template
  // videos, so don't render a second picker here.
  const showOfferPicker = templateId !== 'offer';
  const [wantsService, setWantsService] = useState<boolean | null>(
    serviceId ? true : null
  );
  const {
    services,
    isLoading,
    isError: isServicesError,
    refetch: refetchServices,
  } = useListServices({ limit: 100 });
  const {
    offers,
    isLoading: isLoadingOffers,
    isError: isOffersError,
  } = useListOffers({
    state: 'active',
  });

  // When a service is selected, prefer offers linked to that service.
  // Otherwise show all active offers alphabetically.
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

  const handleYes = () => {
    setWantsService(true);
  };

  const handleNo = () => {
    setWantsService(false);
    form.setValue('serviceId', undefined);
  };

  const handleSelectService = (id: string) => {
    form.setValue('serviceId', id === serviceId ? undefined : id);
  };

  return (
    <div
      className="flex flex-col gap-6"
      data-claire-target="create-video-service-step"
    >
      <div>
        <h2 className="text-2xl font-semibold">
          Is this video for a specific service?
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Linking a service helps organize your content library and can tailor
          the script to your offering.
        </p>
      </div>

      {/* Yes/No toggle buttons */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={handleYes}
          data-claire-target="create-video-service-yes-button"
          className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
            wantsService === true
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/50'
          }`}
        >
          <div
            className={`rounded-full p-2 ${
              wantsService === true
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <SparklesIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-sm">Yes, for a service</p>
            <p className="text-xs text-muted-foreground">
              Select which service this video promotes
            </p>
          </div>
        </button>
        <button
          type="button"
          onClick={handleNo}
          className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-colors ${
            wantsService === false
              ? 'border-primary bg-primary/5'
              : 'border-border hover:border-muted-foreground/50'
          }`}
        >
          <div
            className={`rounded-full p-2 ${
              wantsService === false
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            <XIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium text-sm">No, general content</p>
            <p className="text-xs text-muted-foreground">
              This video isn&apos;t tied to a specific service
            </p>
          </div>
        </button>
      </div>

      {/* Service selector (only when "Yes" is selected) */}
      {wantsService === true && (
        <div className="space-y-3">
          <p className="text-sm font-medium">{L.serviceId}</p>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
              ))}
            </div>
          ) : isServicesError ? (
            // BEFORE the empty state: `services` falls back to [] on a failed
            // request, so the step told a clinic with a full catalogue to go
            // add services in settings — work it had already done.
            <div className="space-y-3 rounded-lg border border-destructive/30 p-6 text-center">
              <p className="text-sm text-destructive">
                Couldn&apos;t load your services.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchServices()}
              >
                Try again
              </Button>
            </div>
          ) : services.length === 0 ? (
            <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-6 text-center">
              No services found. Add services in your organization settings.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {services.map((svc) => {
                const isSelected = serviceId === svc.id;
                return (
                  <button
                    key={svc.id}
                    type="button"
                    onClick={() => handleSelectService(svc.id)}
                    className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted-foreground/50'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{svc.name}</p>
                      <Badge variant="secondary" className="mt-1 text-xs">
                        {serviceCategoryLabels[
                          svc.category as ServiceCategory
                        ] ?? svc.category}
                      </Badge>
                    </div>
                    {isSelected && (
                      <CheckIcon className="h-5 w-5 text-primary shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Optional offer link — shown for non-offer templates. The dedicated
          OfferStep handles offer-template videos separately. */}
      {showOfferPicker && (
        <div className="space-y-2 border-t pt-6">
          <p className="text-sm font-medium">{L.offerId}</p>
          <p className="text-xs text-muted-foreground">
            Associate this video with a promotion so it shows up alongside the
            offer in your library.
          </p>
          {isLoadingOffers ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : isOffersError ? (
            // Linking an offer is optional, so this doesn't block the wizard —
            // but "no active offers yet" would still be a lie, and the user
            // would go to the Offers section to create a duplicate.
            <p className="text-xs text-destructive rounded-md border border-destructive/30 p-3">
              Couldn&apos;t load your offers. This step is optional — you can
              continue and link one later.
            </p>
          ) : sortedOffers.length === 0 ? (
            <p className="text-xs text-muted-foreground rounded-md border border-dashed p-3">
              No active offers yet. You can create one in the Offers section.
            </p>
          ) : (
            <Select
              value={offerId ?? OFFER_NONE_VALUE}
              onValueChange={(value) => {
                form.setValue(
                  'offerId',
                  value === OFFER_NONE_VALUE ? undefined : value,
                  { shouldValidate: true }
                );
              }}
            >
              <SelectTrigger
                className="w-full"
                data-claire-target="create-video-offer-select"
              >
                <SelectValue placeholder="No offer" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={OFFER_NONE_VALUE}>No offer</SelectItem>
                {sortedOffers.map((offer) => (
                  <SelectItem key={offer.id} value={offer.id}>
                    {offer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
