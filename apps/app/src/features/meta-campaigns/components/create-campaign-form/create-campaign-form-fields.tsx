import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';

import {
  type CreateCampaignFormData,
  createCampaignFormLabels as L,
} from './create-campaign-form.schema';

export type OptimizationMode = CreateCampaignFormData['optimizationMode'];

/** Shared copy for the follow-up choice — rendered by both surfaces. */
export const FOLLOW_UP_OPTIONS: {
  value: CreateCampaignFormData['followUpType'];
  label: string;
}[] = [
  { value: 'lead_form', label: 'Leads should fill out a form' },
  { value: 'chatbot', label: 'Leads should message us' },
];

/** Shared copy for the optimization choice — rendered by both surfaces. */
export const OPTIMIZATION_OPTIONS: {
  value: OptimizationMode;
  label: string;
}[] = [
  { value: 'lead_generation', label: 'Lead Generation' },
  { value: 'engagement', label: 'Engagement' },
];

export const OPTIMIZATION_DESCRIPTION =
  'Lead Generation optimizes for form submissions. Engagement optimizes for conversations.';

interface OptimizationModeFieldProps {
  value: OptimizationMode;
  onChange: (value: OptimizationMode) => void;
  layout: 'desktop' | 'mobile';
}

/**
 * Optimization picker for chatbot campaigns (Lead Generation vs Engagement).
 * Callers must gate on `showsOptimizationMode()` — this component renders
 * unconditionally so the visibility rule stays in the shared core.
 *
 * Desktop presents it inside the "Advanced settings" accordion (matching the
 * dialog it has always lived in); mobile presents it inline as a funnel
 * section, since a phone has no room for a nested disclosure.
 */
export function OptimizationModeField({
  value,
  onChange,
  layout,
}: OptimizationModeFieldProps) {
  if (layout === 'mobile') {
    return (
      <div>
        <p className="mb-1.5 text-[13px] font-medium text-[#8E8E93]">
          {L.optimizationMode}
        </p>
        <div className="grid grid-cols-2 gap-2" aria-label={L.optimizationMode}>
          {OPTIMIZATION_OPTIONS.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(option.value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-center text-[15px] font-medium leading-snug transition-colors',
                  selected
                    ? 'border-[#2E65F3] bg-[#2E65F3]/5 text-[#2E65F3]'
                    : 'border-[#E5E5EA] bg-white text-black'
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-[#8E8E93]">
          {OPTIMIZATION_DESCRIPTION}
        </p>
      </div>
    );
  }

  return (
    <Accordion type="single" collapsible className="w-full">
      <AccordionItem value="advanced" className="border-b-0">
        <AccordionTrigger className="py-2 text-sm text-muted-foreground hover:text-foreground">
          Advanced settings
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-2">
            <p className="text-sm font-medium">{L.optimizationMode}</p>
            <p className="text-sm text-muted-foreground">
              {OPTIMIZATION_DESCRIPTION}
            </p>
            <ToggleGroup
              type="single"
              variant="outline"
              value={value}
              onValueChange={(next) => {
                if (next) onChange(next as OptimizationMode);
              }}
              className="w-full"
            >
              {OPTIMIZATION_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="flex-1"
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
