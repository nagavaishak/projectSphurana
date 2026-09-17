import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useGetMetaIntegration } from '@/features/integrations/api';
import { useResolvedRoutes } from '@/lib/use-routes';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal, Pause, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useDeleteCampaign, usePauseCampaign } from '../../api';
import type { Campaign } from '../../api/types';
import { CampaignStatusBadge } from '../campaign-status-badge';
import { DeleteCampaignDialog } from '../delete-campaign-dialog';

interface CampaignCardProps {
  campaign: Campaign;
}

const objectiveLabels: Record<string, string> = {
  OUTCOME_AWARENESS: 'Brand Awareness',
  OUTCOME_ENGAGEMENT: 'Engagement',
  OUTCOME_LEADS: 'Lead Generation',
  OUTCOME_SALES: 'Sales',
  OUTCOME_TRAFFIC: 'Traffic',
};

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

function formatBudget(budgetStr: string | undefined, symbol: string): string {
  if (!budgetStr) return '-';
  const cents = Number(budgetStr);
  if (Number.isNaN(cents) || cents === 0) return '-';
  return `${symbol}${(cents / 100).toFixed(2)}`;
}

export function CampaignCard({ campaign }: CampaignCardProps) {
  const routes = useResolvedRoutes();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { integration, availableAdAccounts } = useGetMetaIntegration();
  const currencySymbol = useMemo(() => {
    const adAccountId = integration?.adAccountId;
    const account = availableAdAccounts.find(
      (acc) => acc.id === adAccountId || acc.accountId === adAccountId
    );
    return getCurrencySymbol(account?.currency ?? 'EUR');
  }, [integration?.adAccountId, availableAdAccounts]);
  const { execute: pause, isExecuting: isPausing } = usePauseCampaign();
  const {
    execute: deleteCampaign,
    isExecuting: isDeleting,
    isSuccess: isDeleteSuccess,
  } = useDeleteCampaign(true, true);

  const isLoading = isPausing || isDeleting;

  // Close dialog on successful delete
  useEffect(() => {
    if (isDeleteSuccess && deleteDialogOpen) {
      setDeleteDialogOpen(false);
    }
  }, [isDeleteSuccess, deleteDialogOpen]);

  const handlePause = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    pause(campaign.id);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    deleteCampaign(campaign.id);
  };

  return (
    <>
      <Link to={routes.advertisingCampaign(campaign.id)}>
        <Card className="hover:shadow-md transition-shadow cursor-pointer">
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div className="space-y-1">
              <CardTitle className="text-base font-medium">
                {campaign.name}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {objectiveLabels[campaign.objective] || campaign.objective}
              </p>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.preventDefault()}>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {campaign.effectiveStatus === 'ACTIVE' && (
                  <DropdownMenuItem onClick={handlePause} disabled={isLoading}>
                    <Pause className="mr-2 h-4 w-4" />
                    Pause
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDeleteClick}
                  disabled={isLoading}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span>
                  Budget: {formatBudget(campaign.dailyBudget, currencySymbol)}
                  /day
                </span>
                {campaign.adCount !== undefined && (
                  <span>{campaign.adCount} ads</span>
                )}
              </div>
              <CampaignStatusBadge status={campaign.effectiveStatus} />
            </div>
          </CardContent>
        </Card>
      </Link>

      <DeleteCampaignDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        campaignName={campaign.name}
        onConfirm={handleDeleteConfirm}
        isDeleting={isDeleting}
      />
    </>
  );
}
