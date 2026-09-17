import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { cn } from '@/lib/utils';
import { Bot, Check, FileText, Loader2, Mail } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import type { AdWizardFormData } from '../../-schema';
import { useCampaignStep } from '../steps/use-campaign-step';

const FOLLOW_UP_META: Record<string, { label: string; icon: typeof Bot }> = {
  chatbot: { label: 'Chatbot', icon: Bot },
  lead_form: { label: 'Lead Form', icon: FileText },
  email: { label: 'Email', icon: Mail },
};

/** Mobile presentation of the shared campaign step (`useCampaignStep`). */
export function AdMobileCampaign() {
  const { control } = useFormContext<AdWizardFormData>();
  const {
    campaigns,
    isLoading,
    isError,
    refetch,
    selectedCampaignId,
    selectCampaign,
    getBudgetLabel,
    hasBudget,
  } = useCampaignStep();

  return (
    <div className="flex flex-col gap-5 px-4 pb-28">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-black">
          Select a campaign
        </h1>
        <p className="mt-0.5 text-[14px] text-[#8E8E93]">
          Choose an existing campaign for this ad
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-xl border border-[#E5E5EA] px-4 py-4">
          <Loader2 className="size-4 animate-spin text-[#8E8E93]" />
          <span className="text-[15px] text-[#8E8E93]">Loading campaigns…</span>
        </div>
      ) : isError ? (
        // Same distinction as the desktop step: a failed load is not an empty
        // org, and telling the user to create a campaign they already have is
        // a dead end.
        <div
          className="p-4 text-center"
          data-claire-target="ads-new-campaign-error"
        >
          <p className="text-[15px] text-destructive">
            Couldn't load your campaigns.
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-[15px] underline"
          >
            Try again
          </button>
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#E5E5EA] px-4 py-10 text-center">
          <p className="text-[15px] text-[#8E8E93]">
            No campaigns yet. Create a campaign from the Advertising page first.
          </p>
        </div>
      ) : (
        <div
          className="flex flex-col gap-3"
          data-claire-target="ads-new-campaign-select"
        >
          {campaigns.map((campaign) => {
            const campaignHasBudget = hasBudget(campaign);
            const isSelected = selectedCampaignId === campaign.id;
            const followUp = campaign.followUpType
              ? FOLLOW_UP_META[campaign.followUpType]
              : undefined;
            const FollowUpIcon = followUp?.icon;

            return (
              <button
                key={campaign.id}
                type="button"
                onClick={() => selectCampaign(campaign.id)}
                className={cn(
                  'flex w-full items-start gap-3 rounded-xl border bg-white px-4 py-3.5 text-left transition-colors',
                  isSelected
                    ? 'border-[#2E65F3] ring-1 ring-[#2E65F3]'
                    : 'border-[#E5E5EA] active:bg-[#F2F2F7]'
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[16px] font-semibold text-black">
                    {campaign.name}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cn(
                        'text-[13px]',
                        campaignHasBudget ? 'text-[#8E8E93]' : 'text-[#FF3B30]'
                      )}
                    >
                      {getBudgetLabel(campaign)}
                      {!campaignHasBudget ? ' ⚠' : ''}
                    </span>
                    {followUp && FollowUpIcon ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#F2F2F7] px-2 py-0.5 text-[12px] font-medium text-[#3C3C43]">
                        <FollowUpIcon className="size-3" />
                        {followUp.label}
                      </span>
                    ) : null}
                  </div>
                </div>
                {isSelected ? (
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-[#2E65F3] text-white">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {/* Hidden field for form validation */}
      <FormField
        control={control}
        name="campaignId"
        render={() => (
          <FormItem className="sr-only">
            <FormMessage className="text-[13px]" />
          </FormItem>
        )}
      />
    </div>
  );
}
