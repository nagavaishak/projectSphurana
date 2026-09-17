import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useListMetaAdsPages } from '@/features/integrations';
import type { MetaAdsPage } from '@/features/integrations/types';
import { useListServices } from '@/features/organization-services';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';
import { Check, ChevronsUpDown, ExternalLink, Facebook } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFormContext } from 'react-hook-form';
import { type AdWizardFormData, adWizardLabels as L } from '../../-schema';

/**
 * Step 1 of the ad wizard: name the ad, choose the single service it promotes
 * (searchable combobox), and pick the Facebook Page that runs it.
 */
export function DetailsStep() {
  const { control, setValue, watch, formState } =
    useFormContext<AdWizardFormData>();

  // --- Service (single, searchable) ---------------------------------------
  const serviceIds = watch('serviceIds') ?? [];
  const selectedServiceId = serviceIds[0];
  const [servicePickerOpen, setServicePickerOpen] = useState(false);
  const {
    services,
    isLoading: isLoadingServices,
    isError: isServicesError,
    refetch: refetchServices,
  } = useListServices({
    limit: 100,
  });
  const activeServices = useMemo(
    () => services.filter((s) => s.isActive),
    [services]
  );
  const selectedService = activeServices.find(
    (s) => s.id === selectedServiceId
  );
  const serviceError = formState.errors.serviceIds;

  // --- Page ---------------------------------------------------------------
  const metaAdsPageId = watch('metaAdsPageId');
  const {
    pages,
    isLoading: isLoadingPages,
    isError: isPagesError,
    refetch: refetchPages,
  } = useListMetaAdsPages();
  const facebookPages = useMemo(
    () =>
      pages.filter((p: MetaAdsPage) => p.platform === 'facebook' && p.isActive),
    [pages]
  );
  const pageError = formState.errors.metaAdsPageId;

  // Auto-select the only page when there's exactly one.
  useEffect(() => {
    if (facebookPages.length === 1 && !metaAdsPageId) {
      setValue('metaAdsPageId', facebookPages[0].id, { shouldValidate: true });
    }
  }, [facebookPages, metaAdsPageId, setValue]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Ad details</h2>
        <p className="text-muted-foreground mt-1">
          Name your ad, pick the service it promotes, and choose the page that
          runs it.
        </p>
      </div>

      {/* Ad Name */}
      <FormField
        control={control}
        name="adName"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{L.adName}</FormLabel>
            <FormControl>
              <Input placeholder="My Ad" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Service (single, searchable combobox) */}
      <div className="space-y-2">
        <FormLabel>{L.serviceIds}</FormLabel>
        {isLoadingServices ? (
          <Skeleton className="h-10 w-full" />
        ) : isServicesError ? (
          // A failed load is not an empty catalogue — see the campaign step.
          <div
            className="rounded-lg border border-dashed p-4 text-center"
            data-claire-target="ads-new-details-services-error"
          >
            <p className="text-sm text-destructive">
              Couldn't load your services.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetchServices()}
            >
              Try again
            </Button>
          </div>
        ) : activeServices.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No services configured yet. Add services in your organization
            settings first.
          </div>
        ) : (
          <Popover open={servicePickerOpen} onOpenChange={setServicePickerOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-expanded={servicePickerOpen}
                className="w-full justify-between font-normal"
              >
                {selectedService ? (
                  selectedService.name
                ) : (
                  <span className="text-muted-foreground">
                    Select a service
                  </span>
                )}
                <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[var(--radix-popover-trigger-width)] p-0"
              align="start"
            >
              <Command>
                <CommandInput
                  placeholder="Search services..."
                  className="h-9"
                />
                <CommandList>
                  <CommandEmpty>No services found.</CommandEmpty>
                  <CommandGroup>
                    {activeServices.map((service) => (
                      <CommandItem
                        key={service.id}
                        value={service.name}
                        onSelect={() => {
                          setValue('serviceIds', [service.id], {
                            shouldValidate: true,
                          });
                          setServicePickerOpen(false);
                        }}
                      >
                        {service.name}
                        <Check
                          className={cn(
                            'ml-auto size-4',
                            selectedServiceId === service.id
                              ? 'opacity-100'
                              : 'opacity-0'
                          )}
                        />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        )}
        {serviceError && (
          <p className="text-sm text-destructive">
            {typeof serviceError.message === 'string'
              ? serviceError.message
              : 'Select a service'}
          </p>
        )}
      </div>

      {/* Facebook Page */}
      <div className="space-y-2">
        <FormLabel>{L.metaAdsPageId}</FormLabel>
        {isLoadingPages ? (
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        ) : isPagesError ? (
          <div
            className="rounded-lg border border-dashed p-4 text-center"
            data-claire-target="ads-new-details-pages-error"
          >
            <p className="text-sm text-destructive">
              Couldn't load your Facebook Pages.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => refetchPages()}
            >
              Try again
            </Button>
          </div>
        ) : facebookPages.length === 0 ? (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <p className="text-sm text-muted-foreground">
              No Facebook Pages found. Please connect a page first.
            </p>
            <Link
              to="/connect/meta-ads"
              className="mt-2 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
            >
              Connect Meta Ads
              <ExternalLink className="size-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {facebookPages.map((page: MetaAdsPage) => {
              const isSelected = metaAdsPageId === page.id;
              return (
                <button
                  key={page.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/50'
                  )}
                  onClick={() =>
                    setValue('metaAdsPageId', page.id, { shouldValidate: true })
                  }
                >
                  <Facebook className="size-4 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">
                      {page.pageName || 'Unnamed Page'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ID: {page.pageId}
                    </p>
                  </div>
                  <div
                    className={cn(
                      'size-5 shrink-0 rounded-full border-2',
                      isSelected
                        ? 'border-primary bg-primary'
                        : 'border-muted-foreground/30'
                    )}
                  >
                    {isSelected && (
                      <div className="flex size-full items-center justify-center">
                        <div className="size-2 rounded-full bg-white" />
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
        {pageError && (
          <p className="text-sm text-destructive">
            {typeof pageError.message === 'string'
              ? pageError.message
              : 'Please select a page'}
          </p>
        )}
      </div>
    </div>
  );
}
