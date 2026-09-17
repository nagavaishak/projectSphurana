import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useListMetaAdsPages } from '@/features/integrations';
import type { MetaAdsPage } from '@/features/integrations/types';
import { Link } from '@tanstack/react-router';
import { ExternalLink, Facebook, Instagram } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import type { AdWizardFormData } from '../../-schema';

export function SelectPageStep() {
  const { setValue, watch, formState } = useFormContext<AdWizardFormData>();
  const metaAdsPageId = watch('metaAdsPageId');
  const adPlacement = watch('adPlacement');

  const { pages, isLoading, isError, refetch } = useListMetaAdsPages();

  const facebookPages = useMemo(
    () =>
      pages.filter((p: MetaAdsPage) => p.platform === 'facebook' && p.isActive),
    [pages]
  );

  const isInstagramOnly = adPlacement === 'instagram';
  const needsInstagram = adPlacement === 'instagram' || adPlacement === 'both';

  // For instagram-only, only show FB pages that have a linked Instagram
  const pagesWithInstagram = useMemo(
    () => facebookPages.filter((p) => !!p.linkedInstagramAccountId),
    [facebookPages]
  );

  const displayPages = isInstagramOnly ? pagesWithInstagram : facebookPages;

  const isBothPlacement = adPlacement === 'both';

  // Clear selection if the selected page doesn't have Instagram when "both" is chosen
  useEffect(() => {
    if (isBothPlacement && metaAdsPageId) {
      const current = facebookPages.find((p) => p.id === metaAdsPageId);
      if (current && !current.linkedInstagramAccountId) {
        setValue('metaAdsPageId', '', { shouldValidate: false });
      }
    }
  }, [isBothPlacement, metaAdsPageId, facebookPages, setValue]);

  // Auto-select if only one eligible page available
  useEffect(() => {
    if (displayPages.length === 1 && !metaAdsPageId) {
      const onlyPage = displayPages[0];
      const wouldBeDisabled =
        isBothPlacement && !onlyPage.linkedInstagramAccountId;
      if (!wouldBeDisabled) {
        setValue('metaAdsPageId', onlyPage.id, { shouldValidate: true });
      }
    }
  }, [displayPages, metaAdsPageId, isBothPlacement, setValue]);

  const error = formState.errors.metaAdsPageId;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-7 w-64" />
          <Skeleton className="mt-1 h-5 w-80" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-20 w-full rounded-lg" />
          <Skeleton className="h-20 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  // Instagram-only with no linked accounts
  if (isInstagramOnly && pagesWithInstagram.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Select an Instagram Account</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No Instagram accounts found. Make sure your Instagram is linked to a
            Facebook Page.
          </p>
        </div>
        <Link
          to="/dashboard/settings/integrations"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          Go to Integration Settings
          <ExternalLink className="size-4" />
        </Link>
      </div>
    );
  }

  // BEFORE the empty state, not after: `pages` defaults to [] on a failed
  // request, so "connect a page first" was being shown to orgs that already
  // had pages connected — sending them to redo work they'd done.
  if (isError) {
    return (
      <div className="space-y-6" data-claire-target="ads-new-pages-error">
        <div>
          <h2 className="text-xl font-semibold">Select a Facebook Page</h2>
          <p className="mt-1 text-sm text-destructive">
            Couldn't load your Facebook Pages.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (facebookPages.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Select a Facebook Page</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            No Facebook Pages found. Please connect a page first.
          </p>
        </div>
        <Link
          to="/connect/meta-ads"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          Connect Meta Ads
          <ExternalLink className="size-4" />
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">
          {isInstagramOnly
            ? 'Select an Instagram Account'
            : isBothPlacement
              ? 'Select your Facebook & Instagram'
              : 'Select a Facebook Page'}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {isInstagramOnly
            ? 'Choose which Instagram account will be used to run your ad.'
            : isBothPlacement
              ? 'Choose the Facebook Page and linked Instagram account for your ad.'
              : 'Choose which Facebook Page will be used to run your ad.'}
        </p>
      </div>

      <div className="space-y-3" data-claire-target="ads-new-pages-list">
        {displayPages.map((page: MetaAdsPage) => {
          const isSelected = metaAdsPageId === page.id;
          const isBoth = adPlacement === 'both';
          const missingInstagram = isBoth && !page.linkedInstagramAccountId;
          const isDisabled = missingInstagram;
          const igDisplayName =
            page.linkedInstagramName ||
            (page.linkedInstagramUsername
              ? `@${page.linkedInstagramUsername}`
              : null);
          return (
            <button
              key={page.id}
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
                setValue('metaAdsPageId', page.id, { shouldValidate: true })
              }
            >
              <div className="flex-1 space-y-1">
                {isInstagramOnly ? (
                  <>
                    <p className="flex items-center gap-2 font-medium">
                      <Instagram className="size-4 shrink-0" />
                      {igDisplayName || 'Instagram Account'}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      via {page.pageName || 'Facebook Page'}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="flex items-center gap-2 font-medium">
                      <Facebook className="size-4 shrink-0" />
                      {page.pageName || 'Unnamed Page'}
                    </p>
                    {isBoth && igDisplayName ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Instagram className="size-4 shrink-0" />
                        {igDisplayName}
                      </p>
                    ) : isBoth && !page.linkedInstagramAccountId ? (
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Instagram className="size-4 shrink-0 opacity-40" />
                        No Instagram account linked
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        ID: {page.pageId}
                      </p>
                    )}
                  </>
                )}
              </div>
              <div
                className={`size-5 shrink-0 rounded-full border-2 ${
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
        })}
      </div>

      {needsInstagram && (
        <p className="text-sm text-muted-foreground">
          Can&apos;t see your Instagram account?{' '}
          <Link
            to="/dashboard/settings/integrations"
            className="font-medium text-primary hover:underline"
          >
            Check your integration settings
          </Link>{' '}
          to make sure it&apos;s linked to a Facebook Page.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive">
          {typeof error.message === 'string'
            ? error.message
            : 'Please select a page'}
        </p>
      )}
    </div>
  );
}
