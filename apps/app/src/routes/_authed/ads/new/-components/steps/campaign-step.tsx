import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField, FormItem, FormMessage } from '@/components/ui/form';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Bot, FileText, Loader2, Mail } from 'lucide-react';
import { useFormContext } from 'react-hook-form';

import { type AdWizardFormData, adWizardLabels as L } from '../../-schema';
import { useCampaignStep } from './use-campaign-step';

/** Desktop presentation of the shared campaign step (`useCampaignStep`). */
export function CampaignStep() {
  const { control } = useFormContext<AdWizardFormData>();
  const {
    campaigns,
    isLoading,
    isError,
    refetch,
    selectedCampaignId,
    selectedCampaign,
    selectCampaign,
    getBudgetLabel,
    hasBudget,
  } = useCampaignStep();

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold">Select a campaign</h2>
        <p className="text-muted-foreground mt-1">
          Choose an existing campaign for this ad
        </p>
      </div>

      {/* Campaign Selection */}
      <div className="space-y-2">
        <Label>{L.campaignId}</Label>
        {isLoading ? (
          <div className="flex items-center gap-2 p-3 border rounded-md">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm text-muted-foreground">
              Loading campaigns...
            </span>
          </div>
        ) : isError ? (
          // NOT the empty state. A failed request used to render "no campaigns
          // created yet", which tells a clinic that HAS campaigns to go and
          // make one — and gave the ad wizard no way forward. Say what actually
          // happened and offer the retry.
          <div
            className="p-4 border rounded-lg text-center space-y-2"
            data-claire-target="ads-new-campaign-error"
          >
            <p className="text-sm text-destructive">
              Couldn't load your campaigns.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="p-4 border rounded-lg text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              No campaigns created yet. Create a campaign from the Advertising
              page first.
            </p>
          </div>
        ) : (
          <Select
            value={selectedCampaignId || ''}
            onValueChange={selectCampaign}
          >
            <SelectTrigger
              aria-label={L.campaignId}
              className="w-full"
              data-claire-target="ads-new-campaign-select"
            >
              <SelectValue placeholder="Select a campaign" />
            </SelectTrigger>
            <SelectContent>
              {campaigns.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  <span>{campaign.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    ({getBudgetLabel(campaign)})
                  </span>
                  {!hasBudget(campaign) && (
                    <span className="ml-1 text-destructive text-xs">⚠</span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Campaign Config Info (read-only) */}
      {selectedCampaign?.followUpType && (
        <div className="flex items-center gap-2 p-3 border rounded-lg bg-muted/50">
          <span className="text-sm text-muted-foreground">Follow-up:</span>
          <Badge variant="secondary" className="gap-1">
            {selectedCampaign.followUpType === 'chatbot' ? (
              <>
                <Bot className="h-3 w-3" />
                Chatbot
              </>
            ) : selectedCampaign.followUpType === 'lead_form' ? (
              <>
                <FileText className="h-3 w-3" />
                Lead Form
              </>
            ) : (
              <>
                <Mail className="h-3 w-3" />
                Email
              </>
            )}
          </Badge>
        </div>
      )}

      {/* Hidden field for form validation */}
      <FormField
        control={control}
        name="campaignId"
        render={() => (
          <FormItem className="hidden">
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
