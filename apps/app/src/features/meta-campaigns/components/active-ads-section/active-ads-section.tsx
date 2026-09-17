import { Button } from '@/components/ui/button';
import type { Ad } from '@/features/meta-ads/api/types';
import { Plus } from 'lucide-react';
import { AdCard } from '../ad-card';

interface ActiveAdsSectionProps {
  ads: Ad[];
  onAddAd?: () => void;
  onEditAd?: (adId: string) => void;
  onDeleteAd?: (adId: string) => void;
  isLoading?: boolean;
}

export function ActiveAdsSection({
  ads,
  onAddAd,
  onEditAd,
  onDeleteAd,
  isLoading = false,
}: ActiveAdsSectionProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Campaign Ads ({ads.length})</h3>
        {onAddAd && (
          <Button onClick={onAddAd} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Ad
          </Button>
        )}
      </div>

      {ads.length === 0 && !isLoading ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No ads in this campaign yet.
          </p>
          {onAddAd && (
            <Button onClick={onAddAd} variant="outline" className="mt-4">
              <Plus className="mr-2 h-4 w-4" />
              Create First Ad
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {isLoading ? (
            <>
              <AdCard ad={{} as Ad} isLoading />
              <AdCard ad={{} as Ad} isLoading />
            </>
          ) : (
            ads.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                onEdit={onEditAd}
                onDelete={onDeleteAd}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
