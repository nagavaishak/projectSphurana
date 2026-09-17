import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useListMetaAdsPages } from '@/features/integrations';
import type { MetaAdsPage } from '@/features/integrations/types';
import { Facebook, Instagram } from 'lucide-react';
import { useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { AdWizardFormData } from '../../-schema';

const PLACEMENT_OPTIONS = [
  {
    value: 'facebook' as const,
    label: 'Facebook',
    description: 'Show your ad on Facebook feeds',
    icons: [Facebook],
  },
  {
    value: 'instagram' as const,
    label: 'Instagram',
    description: 'Show your ad on Instagram feeds and stories',
    icons: [Instagram],
  },
  {
    value: 'both' as const,
    label: 'Facebook & Instagram',
    description: 'Show your ad on both Facebook and Instagram',
    icons: [Facebook, Instagram],
  },
];

export function AdPlacementStep() {
  const { setValue, watch, formState } = useFormContext<AdWizardFormData>();
  const adPlacement = watch('adPlacement');
  const { pages } = useListMetaAdsPages();

  const facebookPages = useMemo(
    () =>
      pages.filter((p: MetaAdsPage) => p.platform === 'facebook' && p.isActive),
    [pages]
  );

  const hasAnyPage = facebookPages.length > 0;
  const hasLinkedInstagram = useMemo(
    () => facebookPages.some((p) => !!p.linkedInstagramAccountId),
    [facebookPages]
  );

  const error = formState.errors.adPlacement;

  const getDisabledReason = (
    value: 'facebook' | 'instagram' | 'both'
  ): string | null => {
    if (value === 'facebook') {
      if (!hasAnyPage)
        return 'No Facebook Pages connected. Please connect a Facebook Page to launch ads.';
      return null;
    }
    if (value === 'instagram') {
      if (!hasLinkedInstagram)
        return 'None of your Facebook Pages have a linked Instagram account. Please link your Instagram to a Facebook Page to launch ads on Instagram.';
      return null;
    }
    // both
    if (!hasAnyPage)
      return 'No Facebook Pages connected. Please connect a Facebook Page to launch ads.';
    if (!hasLinkedInstagram)
      return 'None of your Facebook Pages have a linked Instagram account. Please link your Instagram to a Facebook Page to launch ads on both platforms.';
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Where should your ad appear?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose the platform(s) where people will see your ad.
        </p>
      </div>

      <div className="space-y-3" data-claire-target="ads-new-placement-options">
        {PLACEMENT_OPTIONS.map((option) => {
          const isSelected = adPlacement === option.value;
          const disabledReason = getDisabledReason(option.value);
          const isDisabled = !!disabledReason;

          const button = (
            <button
              key={option.value}
              type="button"
              disabled={isDisabled}
              className={`flex w-full items-center gap-4 rounded-lg border p-4 text-left transition-colors ${
                isDisabled
                  ? 'cursor-not-allowed border-border opacity-50'
                  : isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-accent/50'
              }`}
              onClick={() =>
                !isDisabled &&
                setValue('adPlacement', option.value, {
                  shouldValidate: true,
                })
              }
            >
              <div className="flex items-center gap-2">
                {option.icons.map((Icon, i) => (
                  <div
                    key={`${option.value}-icon-${i}`}
                    className={`flex size-10 items-center justify-center rounded-lg ${
                      isDisabled
                        ? 'bg-muted text-muted-foreground/50'
                        : isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    <Icon className="size-5" />
                  </div>
                ))}
              </div>
              <div className="flex-1">
                <p className="font-medium">{option.label}</p>
                <p className="text-sm text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <div
                className={`size-5 rounded-full border-2 ${
                  isDisabled
                    ? 'border-muted-foreground/20'
                    : isSelected
                      ? 'border-primary bg-primary'
                      : 'border-muted-foreground/30'
                }`}
              >
                {isSelected && !isDisabled && (
                  <div className="flex size-full items-center justify-center">
                    <div className="size-2 rounded-full bg-white" />
                  </div>
                )}
              </div>
            </button>
          );

          if (isDisabled) {
            return (
              <Tooltip key={option.value}>
                <TooltipTrigger asChild>
                  <span className="block">{button}</span>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs">
                  {disabledReason}
                </TooltipContent>
              </Tooltip>
            );
          }

          return button;
        })}
      </div>

      {error && (
        <p className="text-sm text-destructive">
          {typeof error.message === 'string'
            ? error.message
            : 'Please select a placement'}
        </p>
      )}
    </div>
  );
}
