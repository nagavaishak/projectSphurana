import { ChevronRight, ImageIcon, VideoIcon } from 'lucide-react';
import type { ElementType } from 'react';

export type ContentType = 'video' | 'graphic';

interface ContentCreateTypeStepProps {
  onSelect: (type: ContentType) => void;
}

const TYPES: {
  type: ContentType;
  title: string;
  description: string;
  icon: ElementType;
}[] = [
  {
    type: 'video',
    title: 'Video',
    description: 'Choose from organic or paid video templates.',
    icon: VideoIcon,
  },
  {
    type: 'graphic',
    title: 'Graphic',
    description: 'A designed post — single image or carousel.',
    icon: ImageIcon,
  },
];

export function ContentCreateTypeStep({
  onSelect,
}: ContentCreateTypeStepProps) {
  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Create content
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          What would you like to create?
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {TYPES.map(({ type, title, description, icon: Icon }) => (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(type)}
            className="flex items-center gap-4 rounded-2xl border border-[#E5E5EA] bg-white p-4 text-left active:bg-[#F2F2F7]"
          >
            <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[#F2F2F7]">
              <Icon className="size-6 text-[#525252]" strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[17px] font-semibold text-black">{title}</h3>
              <p className="mt-0.5 text-[14px] text-[#8E8E93]">{description}</p>
            </div>
            <ChevronRight className="size-5 shrink-0 text-[#C7C7CC]" />
          </button>
        ))}
      </div>
    </div>
  );
}
