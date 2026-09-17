import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreativePreview } from '@/components/ui/creative-preview';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import {
  DollarSign,
  Lightbulb,
  Megaphone,
  Pencil,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react';
import type { Ad } from '../../api/types';

const ctaLabels: Record<string, string> = {
  LEARN_MORE: 'Learn More',
  SHOP_NOW: 'Shop Now',
  SIGN_UP: 'Sign Up',
  CONTACT_US: 'Contact Us',
  WATCH_MORE: 'Watch More',
  BOOK_NOW: 'Book Now',
  GET_QUOTE: 'Get Quote',
  SUBSCRIBE: 'Subscribe',
  DOWNLOAD: 'Download',
  GET_OFFER: 'Get Offer',
};

function getStatusVariant(
  status: Ad['status']
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'launching':
    case 'pending':
      return 'secondary';
    case 'rejected':
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

function getStatusLabel(status: Ad['status']): string {
  const map: Record<Ad['status'], string> = {
    draft: 'Draft',
    launching: 'Launching',
    pending: 'In Review',
    active: 'Active',
    paused: 'Paused',
    rejected: 'Rejected',
    error: 'Error',
  };
  return map[status];
}

interface Recommendation {
  id: string;
  icon: React.ReactNode;
  title: string;
  description: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
}

function getRecommendations(ad: Ad): Recommendation[] {
  const recs: Recommendation[] = [];

  recs.push({
    id: 'budget-increase',
    icon: <DollarSign className="h-4 w-4" />,
    title: 'Increase daily budget by 20%',
    description:
      'This ad is performing well with strong engagement. Increasing your budget could help reach 30-40% more potential customers while maintaining your current cost per result.',
    impact: 'high',
    category: 'Budget',
  });

  recs.push({
    id: 'audience-expansion',
    icon: <Users className="h-4 w-4" />,
    title: 'Expand your audience targeting',
    description:
      'Consider adding lookalike audiences based on your existing customers. Similar businesses see 25% lower cost per lead with 1-3% lookalike audiences.',
    impact: 'high',
    category: 'Targeting',
  });

  if (!ad.primaryText || ad.primaryText.length < 50) {
    recs.push({
      id: 'longer-copy',
      icon: <Pencil className="h-4 w-4" />,
      title: 'Add more detail to your ad copy',
      description:
        'Ads with 80-100 characters of primary text tend to get 15% higher engagement. Consider adding a customer benefit or social proof.',
      impact: 'medium',
      category: 'Creative',
    });
  } else {
    recs.push({
      id: 'test-copy',
      icon: <Pencil className="h-4 w-4" />,
      title: 'A/B test your ad copy',
      description:
        'Create a variation of this ad with a different hook. Testing 2-3 copy variations typically finds a winner that performs 20-30% better.',
      impact: 'medium',
      category: 'Creative',
    });
  }

  if (ad.adPlacement === 'facebook') {
    recs.push({
      id: 'add-instagram',
      icon: <Megaphone className="h-4 w-4" />,
      title: 'Enable Instagram placements',
      description:
        "You're only running on Facebook. Adding Instagram could increase your reach by 40-60% and often delivers lower cost per engagement for video ads.",
      impact: 'high',
      category: 'Placement',
    });
  } else if (ad.adPlacement === 'instagram') {
    recs.push({
      id: 'add-facebook',
      icon: <Megaphone className="h-4 w-4" />,
      title: 'Enable Facebook placements',
      description:
        'Adding Facebook Feed and Stories can help you reach a wider audience. Cross-platform ads typically see 20% better overall performance.',
      impact: 'medium',
      category: 'Placement',
    });
  }

  recs.push({
    id: 'schedule-optimization',
    icon: <Zap className="h-4 w-4" />,
    title: 'Optimize ad scheduling',
    description:
      'Your target audience is most active between 6-9 PM on weekdays. Consider scheduling your ad delivery during peak hours to maximize engagement.',
    impact: 'medium',
    category: 'Scheduling',
  });

  if (ad.followUpType === 'email_only') {
    recs.push({
      id: 'chatbot-followup',
      icon: <Target className="h-4 w-4" />,
      title: 'Switch to chatbot follow-up',
      description:
        'Businesses using automated chatbot follow-up see 3x higher response rates compared to email-only. Consider enabling Messenger or WhatsApp follow-up.',
      impact: 'high',
      category: 'Follow-up',
    });
  }

  return recs;
}

function getImpactColor(impact: 'high' | 'medium' | 'low'): string {
  switch (impact) {
    case 'high':
      return 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-950';
    case 'medium':
      return 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950';
    case 'low':
      return 'text-blue-600 bg-blue-50 dark:text-blue-400 dark:bg-blue-950';
  }
}

export interface AdDetailContentProps {
  ad: Ad;
  layout?: 'dialog' | 'page';
  onEdit?: (ad: Ad) => void;
}

export function AdDetailContent({
  ad,
  layout = 'dialog',
  onEdit,
}: AdDetailContentProps) {
  const recommendations = getRecommendations(ad);
  const isPage = layout === 'page';

  return (
    <div className={cn(isPage ? 'flex flex-col gap-6' : 'contents')}>
      <div className={cn(isPage ? 'space-y-2' : 'p-6 pb-0')}>
        <div className="flex items-center gap-2">
          <Badge variant={getStatusVariant(ad.status)}>
            {getStatusLabel(ad.status)}
          </Badge>
          {ad.adPlacement ? (
            <Badge variant="outline" className="capitalize">
              {ad.adPlacement}
            </Badge>
          ) : null}
        </div>
        {!isPage ? (
          <>
            <h2 className="text-xl font-semibold leading-none">{ad.name}</h2>
            <p className="text-sm text-muted-foreground">
              Ad preview and AI-powered recommendations
            </p>
          </>
        ) : null}
      </div>

      <div
        className={cn(
          'flex flex-col gap-6 md:flex-row',
          isPage
            ? 'min-h-0 flex-1 pb-[max(16px,env(safe-area-inset-bottom))]'
            : 'max-h-[calc(85vh-120px)] overflow-y-auto p-6 pt-2'
        )}
      >
        <div
          className={cn('flex-shrink-0', isPage ? 'w-full' : 'md:w-[380px]')}
        >
          <div className={isPage ? undefined : 'sticky top-0'}>
            <h3 className="mb-3 text-sm font-medium text-muted-foreground">
              Ad Preview
            </h3>

            <div className="overflow-hidden rounded-lg border bg-card shadow-lg">
              <div className="flex items-center gap-3 p-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-sm font-bold text-white">
                  B
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {ad.name}
                  </p>
                  <p className="text-xs text-muted-foreground">Sponsored</p>
                </div>
              </div>

              <div className="px-3 pb-2">
                <p
                  className={cn(
                    'text-sm',
                    ad.primaryText
                      ? 'text-foreground'
                      : 'italic text-muted-foreground'
                  )}
                >
                  {ad.primaryText || 'No primary text set'}
                </p>
              </div>

              {/*
                A feed card shows the creative WHOLE. This used to be a fixed
                16:9 box with `object-cover`, which centre-cropped every 4:5
                graphic and 9:16 video the product actually makes.
              */}
              <CreativePreview
                videoUrl={ad.video?.videoUrl}
                imageUrl={
                  ad.graphicImageUrl ||
                  ad.video?.thumbnailUrl ||
                  ad.metaThumbnailUrl
                }
                alt={ad.name}
                width={ad.video?.videoUrl ? null : ad.graphicImageWidth}
                height={ad.video?.videoUrl ? null : ad.graphicImageHeight}
                maxHeightPx={420}
                className="[&>div]:rounded-none [&>div]:border-x-0"
              />

              <div className="border-t bg-muted/50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-xs',
                        ad.description || ad.destinationUrl
                          ? 'text-muted-foreground'
                          : 'italic text-muted-foreground/50'
                      )}
                    >
                      {ad.description ||
                        ad.destinationUrl ||
                        'No description set'}
                    </p>
                    <p
                      className={cn(
                        'truncate text-sm font-semibold',
                        ad.headline
                          ? 'text-foreground'
                          : 'italic text-muted-foreground'
                      )}
                    >
                      {ad.headline || 'No headline set'}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="whitespace-nowrap rounded border bg-muted px-4 py-2 text-sm font-semibold text-foreground"
                  >
                    {ctaLabels[ad.callToAction] || 'Learn More'}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between border-t px-3 py-2 text-muted-foreground">
                <div className="flex items-center gap-1">
                  <span className="text-sm">👍</span>
                  <span className="text-sm">❤️</span>
                </div>
                <div className="text-xs">Like · Comment · Share</div>
              </div>
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground">
              Facebook Ad Preview
            </p>

            {onEdit ? (
              <div className="mt-4">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onEdit(ad)}
                >
                  <Pencil className="h-4 w-4" />
                  Edit Ad Creative
                </Button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">AI Recommendations</h3>
              <p className="text-xs text-muted-foreground">
                Suggestions to improve your ad performance
              </p>
            </div>
          </div>

          <div className="mb-4 rounded-lg border bg-gradient-to-r from-primary/5 to-primary/10 p-4">
            <div className="flex items-start gap-3">
              <TrendingUp className="mt-0.5 h-5 w-5 text-primary" />
              <div>
                <p className="text-sm font-medium">Performance Summary</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This ad has strong creative fundamentals. Based on similar ads
                  in your industry, we&apos;ve identified{' '}
                  {recommendations.filter((r) => r.impact === 'high').length}{' '}
                  high-impact opportunities to boost your results.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div
                key={rec.id}
                className="rounded-lg border p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg',
                      getImpactColor(rec.impact)
                    )}
                  >
                    {rec.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <p className="text-sm font-medium">{rec.title}</p>
                      <Badge
                        variant="outline"
                        className={cn(
                          'px-1.5 py-0 text-[10px]',
                          getImpactColor(rec.impact)
                        )}
                      >
                        {rec.impact} impact
                      </Badge>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {rec.description}
                    </p>
                    <div className="mt-2">
                      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {rec.category}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <Separator className="my-4" />

          <div className="rounded-lg border border-dashed p-4 text-center">
            <Lightbulb className="mx-auto mb-2 h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">Want more insights?</p>
            <p className="mt-1 text-xs text-muted-foreground">
              As your ad runs, we&apos;ll provide more personalized
              recommendations based on real performance data.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
