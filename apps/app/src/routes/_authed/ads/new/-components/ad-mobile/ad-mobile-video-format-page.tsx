import {
  MobileDashboardHeader,
  MobileDashboardHeaderProvider,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';
import { MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS } from '@/features/mobile-dashboard-header/mobile-dashboard-header-layout';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { VIDEO_FORMAT_IDEAS } from '@/lib/video-format-ideas';
import { useNavigate } from '@tanstack/react-router';
import {
  Award,
  BookOpen,
  type LucideIcon,
  RefreshCw,
  Sparkles,
  Tag,
} from 'lucide-react';
import { useCallback } from 'react';

const FORMAT_ICONS: Record<string, LucideIcon> = {
  authority: Award,
  'before-after': RefreshCw,
  educational: BookOpen,
  offer: Tag,
};

interface AdMobileVideoFormatPageProps {
  campaignId: string;
}

function AdMobileVideoFormatPageInner({
  campaignId,
}: AdMobileVideoFormatPageProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();

  const handleBack = useCallback(() => {
    void navigate({
      to: routes.advertisingCampaign(campaignId),
    });
  }, [navigate, campaignId, routes.advertisingCampaign]);

  useMobileDashboardHeaderContent({
    heading: 'New video',
    showBack: true,
    centerTitle: true,
    compactTitle: true,
    hideNotifications: true,
    hideTrailing: true,
    onBack: handleBack,
  });

  const handleSelectFormat = (templateId: string) => {
    void navigate({
      to: '/create-video/$templateId',
      params: { templateId },
      search: { source: 'ads', campaignId },
    });
  };

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col bg-white',
        MOBILE_DASHBOARD_HEADER_CLEARANCE_CLASS
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-8 pt-2">
        <div>
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-black">
            Which ad format should we use?
          </h1>
          <p className="mt-2 text-[15px] leading-snug text-[#8E8E93]">
            Select a proven video format to get started.
          </p>
        </div>

        <ul className="flex flex-col gap-3">
          {VIDEO_FORMAT_IDEAS.map((idea) => {
            const Icon = FORMAT_ICONS[idea.id] ?? Award;
            return (
              <li key={idea.id}>
                <button
                  type="button"
                  onClick={() => handleSelectFormat(idea.id)}
                  className={cn(
                    'relative flex w-full items-start gap-3 rounded-2xl border border-[#E5E5EA] bg-white p-4 text-left',
                    'active:bg-[#F9F9FB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2E65F3]'
                  )}
                >
                  {idea.isRecommended ? (
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md bg-[#2E65F3] px-2 py-0.5 text-[11px] font-semibold text-white">
                      <Sparkles className="size-3" aria-hidden />
                      Recommended
                    </span>
                  ) : null}
                  <div
                    className={cn(
                      'flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#E8F0FE]',
                      idea.isRecommended && 'mt-6'
                    )}
                  >
                    <Icon
                      className="size-6 text-[#2E65F3]"
                      strokeWidth={1.75}
                    />
                  </div>
                  <div
                    className={cn(
                      'min-w-0 flex-1',
                      idea.isRecommended && 'mt-6'
                    )}
                  >
                    <p className="text-[17px] font-semibold text-black">
                      {idea.title}
                    </p>
                    <p className="mt-0.5 text-[14px] leading-snug text-[#8E8E93]">
                      {idea.description}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export function AdMobileVideoFormatPage({
  campaignId,
}: AdMobileVideoFormatPageProps) {
  return (
    <MobileDashboardHeaderProvider>
      <AdMobileVideoFormatPageInner campaignId={campaignId} />
      <MobileDashboardHeader />
    </MobileDashboardHeaderProvider>
  );
}
