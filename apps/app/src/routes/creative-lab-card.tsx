import type { Ad } from '@/features/meta-ads/api/types';
import { AdDetailContent } from '@/features/meta-ads/components/ad-detail-panel/ad-detail-content';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { labSamples } from './-creative-lab-fixture';

/** DEV-ONLY: the mobile ad-detail feed card, rendered against real creatives. */
export const Route = createFileRoute('/creative-lab-card')({
  component: LabCard,
  // DEV-ONLY. The lab is a developer harness, not a product surface — it must
  // not be reachable on a deployed build.
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
});

function fakeAd(s: (typeof labSamples)[number]): Ad {
  return {
    id: s.id,
    name: s.name,
    status: 'active',
    adPlacement: 'facebook',
    primaryText:
      'Most people don’t realise how much skin can change without a needle in sight. New client intro offer available — message us to book.',
    headline: 'Look Younger. No Injections Required.',
    description: null,
    callToAction: 'SIGN_UP',
    destinationUrl: null,
    metaThumbnailUrl: s.image,
    graphicImageUrl: s.kind === 'graphic' ? s.image : null,
    graphicImageWidth: s.kind === 'graphic' ? s.w : null,
    graphicImageHeight: s.kind === 'graphic' ? s.h : null,
    video: s.video
      ? { videoUrl: s.video, thumbnailUrl: s.image, title: s.name, duration: 0 }
      : undefined,
  } as unknown as Ad;
}

function LabCard() {
  const picks = ['graphic', 'video', 'imported'].flatMap((kind) => {
    const pool = labSamples.filter((s) => s.kind === kind);
    const seen = new Set<string>();
    return pool
      .filter((s) => {
        const k = `${s.w}x${s.h}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, 2);
  });

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <h1 className="mb-3 text-base font-bold">Ad detail card (mobile page)</h1>
      <div className="flex gap-4 overflow-x-auto">
        {picks.map((s) => (
          <div
            key={s.id}
            className="w-[390px] shrink-0 rounded-lg border bg-background p-3"
          >
            <p className="mb-2 text-xs font-semibold">
              {s.kind} — {s.w}×{s.h}
            </p>
            <AdDetailContent ad={fakeAd(s)} layout="page" />
          </div>
        ))}
      </div>
    </div>
  );
}
