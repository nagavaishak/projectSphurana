import { Skeleton } from '@/components/ui/skeleton';
import { useGetAd } from '@/features/meta-ads/api';
import { AdDetailContent } from '@/features/meta-ads/components/ad-detail-panel/ad-detail-content';
import { useMobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

interface CampaignMobileAdDetailProps {
  campaignId: string;
  adId: string;
}

export function CampaignMobileAdDetail({
  campaignId,
  adId,
}: CampaignMobileAdDetailProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { ad, isLoading, isError } = useGetAd(adId);

  const handleBack = useCallback(() => {
    void navigate({
      to: routes.advertisingCampaign(campaignId),
    });
  }, [navigate, campaignId, routes.advertisingCampaign]);

  useMobileDashboardHeaderContent({
    heading: ad?.name ?? 'Ad details',
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideNotifications: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  if (isLoading) {
    return (
      <div className={cn('flex min-h-dvh flex-col gap-4 bg-white px-4')}>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="aspect-video w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (isError || !ad) {
    return (
      <div
        className={cn(
          'flex min-h-dvh flex-col items-center justify-center bg-white px-6'
        )}
      >
        <p className="text-center text-[15px] text-destructive">
          Failed to load ad details.
        </p>
      </div>
    );
  }

  return (
    <div className={cn('flex min-h-dvh flex-col overflow-hidden bg-white')}>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 [-webkit-overflow-scrolling:touch]">
        <AdDetailContent ad={ad} layout="page" />
      </div>
    </div>
  );
}
