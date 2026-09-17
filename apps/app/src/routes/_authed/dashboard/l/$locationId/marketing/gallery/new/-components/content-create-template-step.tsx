import { MobileSegmentedTabs } from '@/features/mobile-ui';
import type { MobileSegmentedTab } from '@/features/mobile-ui';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';

import {
  CONTENT_TEMPLATE_FILTERS,
  type ContentTemplateFilter,
  filterContentTemplates,
} from './content-create-templates';

interface ContentCreateTemplateStepProps {
  onSelect: (templateId: string) => void;
}

const FILTER_TABS: MobileSegmentedTab[] = CONTENT_TEMPLATE_FILTERS.map((f) => ({
  value: f.value,
  label: f.label,
  ariaLabel: f.label,
}));

export function ContentCreateTemplateStep({
  onSelect,
}: ContentCreateTemplateStepProps) {
  const [filter, setFilter] = useState<ContentTemplateFilter>('all');
  const templates = filterContentTemplates(filter);

  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Choose a template
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          Pick a format to start the video
        </p>
      </div>

      <div className="-mx-4 overflow-x-auto px-4">
        <MobileSegmentedTabs
          value={filter}
          onValueChange={(value) => setFilter(value as ContentTemplateFilter)}
          tabs={FILTER_TABS}
          aria-label="Template type"
        />
      </div>

      <div className="flex flex-col gap-3">
        {templates.map((template) => {
          const Icon = template.icon;
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.id)}
              className="flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white p-4 text-left active:bg-[#F2F2F7]"
            >
              <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F7]">
                <Icon className="size-6 text-[#525252]" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] font-semibold text-black">
                  {template.title}
                </h3>
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
