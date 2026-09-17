import { useListGraphicTemplates } from '@/features/graphics/api/list-graphic-templates';
import { MobileSegmentedTabs } from '@/features/mobile-ui';
import type { MobileSegmentedTab } from '@/features/mobile-ui';
import { graphicTemplateIcon } from '@/lib/graphic-template-icons';
import { ChevronRight, Sparkles } from 'lucide-react';
import { useState } from 'react';

/**
 * Graphic style picker for the create-content wizard — mirrors the video
 * template step's look. Lists the curated organic graphic templates from
 * `GET /graphics/templates`, plus a "Surprise me" row that keeps the
 * server-side style rotation.
 */

type GraphicKindFilter = 'all' | 'carousel' | 'single';

const FILTER_TABS: MobileSegmentedTab[] = [
  { value: 'all', label: 'All', ariaLabel: 'All' },
  { value: 'carousel', label: 'Carousels', ariaLabel: 'Carousels' },
  { value: 'single', label: 'Singles', ariaLabel: 'Singles' },
];

interface ContentCreateGraphicTemplateStepProps {
  /** `null` = "Surprise me" (server picks and rotates styles). */
  onSelect: (templateSlug: string | null) => void;
}

export function ContentCreateGraphicTemplateStep({
  onSelect,
}: ContentCreateGraphicTemplateStepProps) {
  const [filter, setFilter] = useState<GraphicKindFilter>('all');
  const { templates, isLoading } = useListGraphicTemplates('organic');

  const filtered =
    filter === 'all' ? templates : templates.filter((t) => t.kind === filter);

  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Choose a style
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          We design the post around your service
        </p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <MobileSegmentedTabs
          value={filter}
          onValueChange={(value) => setFilter(value as GraphicKindFilter)}
          tabs={FILTER_TABS}
          aria-label="Graphic style type"
        />
      </div>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white p-4 text-left active:bg-[#F2F2F7]"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F7]">
            <Sparkles className="size-6 text-[#525252]" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-[17px] font-semibold text-black">
              Surprise me
            </h3>
            <p className="mt-0.5 line-clamp-2 text-[14px] text-[#8E8E93]">
              We pick the style. Different every time.
            </p>
          </div>
          <ChevronRight className="size-5 shrink-0 text-[#C7C7CC]" />
        </button>

        {isLoading && (
          <p className="px-1 text-[14px] text-[#8E8E93]">Loading styles…</p>
        )}

        {filtered.map((template) => {
          const Icon = graphicTemplateIcon(template.slug, template.kind);
          return (
            <button
              key={template.slug}
              type="button"
              onClick={() => onSelect(template.slug)}
              className="flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white p-4 text-left active:bg-[#F2F2F7]"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F7]">
                <Icon className="size-6 text-[#525252]" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate text-[17px] font-semibold text-black">
                    {template.label}
                  </h3>
                  <span className="shrink-0 rounded-md bg-[#F2F2F7] px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-[#8E8E93]">
                    {template.kind === 'carousel' ? 'Carousel' : 'Single'}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[14px] text-[#8E8E93]">
                  {template.description}
                </p>
              </div>
              <ChevronRight className="size-5 shrink-0 text-[#C7C7CC]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
