import { createFileRoute, notFound, useSearch } from '@tanstack/react-router';
import { z } from 'zod';
import { labSamples } from './-creative-lab-fixture';
import { VARIANTS, type VariantKey } from './-creative-lab-variants';

/**
 * DEV-ONLY harness for the ad-creative preview. Renders real production
 * creatives (sampled by `scripts/sample-ad-creatives.ts`) inside a container
 * that reproduces the real ad side panel — a SCROLLING FLEX COLUMN, which is
 * where the squashing lives. Not linked from anywhere.
 *
 *   /creative-lab?variant=D_aspectFrameLowRes&kind=video
 */
const searchSchema = z.object({
  variant: z.string().optional(),
  kind: z.string().optional(),
  count: z.coerce.number().optional(),
  /** `0` hides the server-known intrinsic dimensions, forcing measure-on-load. */
  dims: z.coerce.number().optional(),
  /** Panel width in px — the real side panel is ~420 desktop, ~330 on mobile. */
  panel: z.coerce.number().optional(),
});

export const Route = createFileRoute('/creative-lab')({
  component: CreativeLab,
  // DEV-ONLY. The lab is a developer harness, not a product surface — it must
  // not be reachable on a deployed build.
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  validateSearch: searchSchema,
});

type Sample = {
  id: string;
  name: string;
  kind: string;
  video: string | null;
  image: string | null;
  w: number | null;
  h: number | null;
};

/**
 * Synthetic shapes the production sample does not happen to contain, plus the
 * failure paths. Inline SVG data URIs so they need no fixture and are always
 * available, even before anyone has run the sampler.
 */
function svgSample(w: number, h: number, name: string): Sample {
  const fontSize = Math.max(24, Math.min(w, h) / 6);
  const svg = [
    `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>`,
    `<rect width='100%' height='100%' fill='#3c5aa0'/>`,
    `<rect x='8' y='8' width='${w - 16}' height='${h - 16}' fill='none' stroke='white' stroke-width='8'/>`,
    `<text x='50%' y='50%' font-size='${fontSize}' fill='white' text-anchor='middle' dominant-baseline='middle' font-family='sans-serif'>${w}×${h}</text>`,
    '</svg>',
  ].join('');
  return {
    id: `edge-${name}`,
    name,
    kind: 'edge',
    video: null,
    image: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    w,
    h,
  };
}

const edgeSamples: Sample[] = [
  svgSample(1920, 1080, '16:9 landscape'),
  svgSample(2400, 600, '4:1 ultrawide'),
  svgSample(600, 1600, '3:8 ultratall'),
  svgSample(64, 36, 'tiny 64×36 thumb'),
  {
    id: 'edge-broken-image',
    name: 'broken image URL',
    kind: 'edge',
    video: null,
    image: '/__creative-lab/does-not-exist.jpg',
    w: null,
    h: null,
  },
  {
    id: 'edge-broken-video',
    name: 'broken video URL',
    kind: 'edge',
    video: '/__creative-lab/does-not-exist.mp4',
    image: null,
    w: null,
    h: null,
  },
  {
    id: 'edge-none',
    name: 'no media at all',
    kind: 'edge',
    video: null,
    image: null,
    w: null,
    h: null,
  },
];

const samples: Sample[] = [...(labSamples as Sample[]), ...edgeSamples];

/** The real side panel: fixed-width, scrolling flex column with form siblings. */
function PanelHarness({
  title,
  width = 420,
  children,
}: {
  title: string;
  width?: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex h-[640px] shrink-0 flex-col rounded-lg border bg-background"
      style={{ width }}
    >
      <div className="truncate border-b p-2 text-xs font-semibold">{title}</div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {children}
        <div className="space-y-2">
          <div className="h-8 shrink-0 rounded border bg-muted/40" />
          <div className="h-20 shrink-0 rounded border bg-muted/40" />
          <div className="h-8 shrink-0 rounded border bg-muted/40" />
        </div>
      </div>
    </div>
  );
}

function CreativeLab() {
  const search = useSearch({ from: '/creative-lab' });
  const variantKey = (search.variant ?? 'A_current') as VariantKey;
  const Variant = VARIANTS[variantKey] ?? VARIANTS.A_current;
  const kinds = search.kind
    ? [search.kind]
    : ['imported', 'graphic', 'video', 'edge'];
  const count = search.count ?? 3;

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold">Creative preview lab</h1>
        {Object.keys(VARIANTS).map((k) => (
          <a
            key={k}
            href={`/creative-lab?variant=${k}${search.kind ? `&kind=${search.kind}` : ''}`}
            className={
              k === variantKey
                ? 'rounded bg-primary px-2 py-1 text-xs text-primary-foreground'
                : 'rounded border px-2 py-1 text-xs'
            }
          >
            {k}
          </a>
        ))}
        {['imported', 'graphic', 'video', 'edge'].map((kind) => (
          <a
            key={kind}
            href={`/creative-lab?variant=${variantKey}&kind=${kind}`}
            className="rounded border px-2 py-1 text-xs"
          >
            {kind}
          </a>
        ))}
      </div>

      {kinds.map((kind) => {
        // One per distinct shape first, so a rare 9:16 is never crowded out by
        // three identical 1:1s.
        const pool = samples.filter((s) => s.kind === kind);
        const seenAspect = new Set<string>();
        const spread = pool.filter((s) => {
          const key = `${s.w}x${s.h}`;
          if (seenAspect.has(key)) return false;
          seenAspect.add(key);
          return true;
        });
        const items = [
          ...spread,
          ...pool.filter((s) => !spread.includes(s)),
        ].slice(0, count);
        return (
          <section key={kind} className="mb-6">
            <h2 className="mb-2 text-sm font-semibold capitalize">{kind}</h2>
            <div className="flex gap-3">
              {items.map((s) => (
                <PanelHarness
                  key={s.id}
                  width={search.panel}
                  title={`${s.name} — ${s.w}×${s.h}`}
                >
                  <div
                    className="contents"
                    data-lab-media
                    data-lab-name={s.name}
                    data-lab-kind={s.kind}
                    data-lab-w={s.w ?? ''}
                    data-lab-h={s.h ?? ''}
                  >
                    <Variant
                      videoUrl={s.video}
                      imageUrl={s.image}
                      alt={s.name}
                      width={search.dims === 0 ? null : s.w}
                      height={search.dims === 0 ? null : s.h}
                    />
                  </div>
                </PanelHarness>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
