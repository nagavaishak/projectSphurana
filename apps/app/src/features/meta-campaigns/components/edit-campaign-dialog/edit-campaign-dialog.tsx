import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useGetMetaIntegration } from '@/features/integrations/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useUpdateCampaign } from '../../api';
import type { Campaign } from '../../api/types';

function getCurrencySymbol(currencyCode: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? currencyCode;
  } catch {
    return currencyCode;
  }
}

const editCampaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
  dailyBudget: z.string().min(1, 'Daily budget is required'),
});

type FormData = z.infer<typeof editCampaignSchema>;

interface EditCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
}

export function EditCampaignDialog({
  open,
  onOpenChange,
  campaign,
}: EditCampaignDialogProps) {
  const { executeAsync, isExecuting } = useUpdateCampaign({
    onSuccess: () => onOpenChange(false),
  });
  const { integration, availableAdAccounts } = useGetMetaIntegration();

  const currencySymbol = useMemo(() => {
    const adAccountId = integration?.adAccountId;
    const account = availableAdAccounts.find(
      (acc) => acc.id === adAccountId || acc.accountId === adAccountId
    );
    return getCurrencySymbol(account?.currency ?? 'EUR');
  }, [integration?.adAccountId, availableAdAccounts]);

  // Convert cents to dollars for display
  const currentBudgetDollars = campaign.dailyBudget
    ? (Number(campaign.dailyBudget) / 100).toFixed(2)
    : '';

  const form = useForm<FormData>({
    resolver: zodResolver(editCampaignSchema),
    defaultValues: {
      name: campaign.name,
      dailyBudget: currentBudgetDollars,
    },
  });

  // Reset form when campaign changes or dialog opens
  useEffect(() => {
    if (open) {
      form.reset({
        name: campaign.name,
        dailyBudget: campaign.dailyBudget
          ? (Number(campaign.dailyBudget) / 100).toFixed(2)
          : '',
      });
    }
  }, [open, campaign, form]);

  const onSubmit = async (data: FormData) => {
    try {
      const budgetCents = Math.round(Number.parseFloat(data.dailyBudget) * 100);
      await executeAsync({
        metaCampaignId: campaign.id,
        name: data.name,
        dailyBudget: budgetCents,
      });
    } catch {
      // Error is handled by the hook's onError callback
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-[425px]"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>Edit Campaign</DialogTitle>
          <DialogDescription>
            Update your campaign name or daily budget.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Campaign Name</FormLabel>
                  <FormControl>
                    <Input placeholder="My Campaign" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="dailyBudget"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Daily Budget ({currencySymbol})</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      step="0.01"
                      min="1"
                      placeholder="50.00"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isExecuting}>
                {isExecuting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
