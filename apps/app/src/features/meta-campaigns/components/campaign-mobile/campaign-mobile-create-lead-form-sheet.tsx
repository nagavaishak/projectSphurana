import { MobileBottomSheet } from '@/components/mobile-bottom-sheet/mobile-bottom-sheet';
import type { LeadForm } from '@/features/lead-forms/api/types';
import { getLeadFormFieldsPreview } from '@/features/meta-campaigns/components/create-campaign-form';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface CampaignMobileCreateLeadFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  leadForms: LeadForm[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export function CampaignMobileCreateLeadFormSheet({
  open,
  onOpenChange,
  leadForms,
  selectedId,
  onSelect,
}: CampaignMobileCreateLeadFormSheetProps) {
  return (
    <MobileBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Select lead form"
      className="z-[110]"
    >
      <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [-webkit-overflow-scrolling:touch]">
        {leadForms.map((form) => {
          const isSelected = form.id === selectedId;
          return (
            <li key={form.id}>
              <button
                type="button"
                onClick={() => {
                  onSelect(form.id);
                  onOpenChange(false);
                }}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left active:bg-[#F2F2F7]',
                  isSelected && 'bg-[#F2F2F7]'
                )}
              >
                <Check
                  className={cn(
                    'mt-0.5 size-5 shrink-0 text-[#2E65F3]',
                    isSelected ? 'opacity-100' : 'opacity-0'
                  )}
                  strokeWidth={2.5}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[16px] font-medium text-black">
                    {form.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-[#8E8E93]">
                    {getLeadFormFieldsPreview(form)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </MobileBottomSheet>
  );
}
