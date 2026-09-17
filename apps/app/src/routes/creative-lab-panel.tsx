import { SidePanelProvider } from '@/components/app/side-panel';
import { Badge } from '@/components/ui/badge';
import type { Ad } from '@/features/meta-ads/api/types';
import { AdSidePanel } from '@/features/meta-ads/components/ad-side-panel';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { type LabAd, labCampaigns } from './-creative-lab-campaigns';

/**
 * DEV-ONLY. The ad side panel exactly as it appears on the campaign page —
 * real width (`md:w-[28rem]`), real scrolling flex column, real component —
 * rendered against several real customers' campaigns.
 *
 * Populate with:
 *   scripts/prod-run.sh pnpm exec tsx scripts/sample-ad-campaigns.ts
 *
 *   /creative-lab-panel            what the panel looks like after this change
 *   /creative-lab-panel?before=1   the stored 64x64 Meta thumbnail, for contrast
 */
export const Route = createFileRoute('/creative-lab-panel')({
  component: CampaignPanelLab,
  validateSearch: (search: Record<string, unknown>) => ({
    // The router JSON-parses search values, so `?before=1` can arrive as the
    // number 1, the string '1', or true depending on how it was written.
    before: Boolean(search.before) && search.before !== 'false',
    /** Render a single organisation, for one-shot screenshots. */
    org: typeof search.org === 'string' ? search.org : undefined,
  }),
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
});

/**
 * The lab's flat sample shaped into the `Ad` the panel consumes. `before`
 * swaps in the stored 64x64 thumbnail so the same panel can be seen both ways.
 */
function toAd(labAd: LabAd, before: boolean): Ad {
  const image = before ? (labAd.imageBefore ?? labAd.image) : labAd.image;
  const w = before ? labAd.wBefore : labAd.w;
  const h = before ? labAd.hBefore : labAd.h;
  const isGraphic = labAd.kind === 'graphic';
  return {
    id: labAd.id,
    name: labAd.name,
    status: labAd.status,
    adPlacement: labAd.adPlacement,
    headline: labAd.headline,
    primaryText: labAd.primaryText,
    description: labAd.description,
    callToAction: labAd.callToAction,
    destinationUrl: labAd.destinationUrl,
    isImported: labAd.isImported,
    leadFormId: labAd.hasLeadForm ? 'lead-form' : null,
    destinations: null,
    metaThumbnailUrl: image,
    graphicImageUrl: isGraphic ? image : null,
    graphicImageWidth: isGraphic ? w : null,
    graphicImageHeight: isGraphic ? h : null,
    video: labAd.video
      ? {
          videoUrl: labAd.video,
          thumbnailUrl: image,
          title: labAd.name,
          duration: 0,
        }
      : undefined,
  } as unknown as Ad;
}

/** The side panel's real geometry: 28rem wide, full height, its own scroll. */
function PanelFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[760px] w-[28rem] shrink-0 overflow-hidden rounded-xl border bg-background shadow-xl">
      <SidePanelProvider>{children}</SidePanelProvider>
    </div>
  );
}

function CampaignPanelLab() {
  const { before, org } = Route.useSearch();

  if (!labCampaigns.length) {
    return (
      <div className="p-8 text-sm text-muted-foreground">
        No campaigns loaded. Run{' '}
        <code className="rounded bg-muted px-1.5 py-0.5">
          scripts/prod-run.sh pnpm exec tsx scripts/sample-ad-campaigns.ts
        </code>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 p-6">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-bold">Campaign ad panel</h1>
        <a
          href="/creative-lab-panel"
          className={
            before
              ? 'rounded border px-2 py-1 text-xs'
              : 'rounded bg-primary px-2 py-1 text-xs text-primary-foreground'
          }
        >
          after
        </a>
        <a
          href="/creative-lab-panel?before=1"
          className={
            before
              ? 'rounded bg-primary px-2 py-1 text-xs text-primary-foreground'
              : 'rounded border px-2 py-1 text-xs'
          }
        >
          before
        </a>
      </div>

      {labCampaigns
        .filter((c) => !org || c.organizationId === org)
        .map((campaign) => (
          <section key={campaign.organizationId} className="mb-10">
            <div className="mb-3 flex items-center gap-2">
              <h2 className="text-base font-semibold">
                {campaign.organizationName}
              </h2>
              <Badge variant="outline">{campaign.ads.length} ads</Badge>
            </div>
            <div className="flex gap-4 overflow-x-auto pb-3">
              {campaign.ads.slice(0, 3).map((labAd) => (
                <div key={labAd.id}>
                  <p className="mb-1 text-xs text-muted-foreground">
                    {labAd.kind} ·{' '}
                    {before
                      ? `${labAd.wBefore ?? labAd.w}×${labAd.hBefore ?? labAd.h}`
                      : `${labAd.w}×${labAd.h}`}
                  </p>
                  <PanelFrame>
                    <AdSidePanel ad={toAd(labAd, before)} />
                  </PanelFrame>
                </div>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
