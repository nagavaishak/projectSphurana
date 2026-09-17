import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CampaignStatusBadgeProps {
  status: string;
  className?: string;
}

/**
 * Status config for Meta campaign statuses.
 * Meta returns uppercase statuses like 'ACTIVE', 'PAUSED', etc.
 */
const statusConfig: Record<string, { label: string; className: string }> = {
  ACTIVE: {
    label: 'Active',
    className: 'bg-green-100 text-green-700 border-green-200',
  },
  PAUSED: {
    label: 'Paused',
    className: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  DELETED: {
    label: 'Deleted',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
  ARCHIVED: {
    label: 'Archived',
    className: 'bg-slate-100 text-slate-700 border-slate-200',
  },
  IN_PROCESS: {
    label: 'Processing',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  WITH_ISSUES: {
    label: 'Issues',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
  CAMPAIGN_PAUSED: {
    label: 'Campaign Paused',
    className: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  ADSET_PAUSED: {
    label: 'Ad Set Paused',
    className: 'bg-orange-100 text-orange-700 border-orange-200',
  },
  DISAPPROVED: {
    label: 'Disapproved',
    className: 'bg-red-100 text-red-700 border-red-200',
  },
  PENDING_REVIEW: {
    label: 'Pending Review',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
  PENDING_BILLING_INFO: {
    label: 'Pending Billing',
    className: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  },
};

const defaultConfig = {
  label: 'Unknown',
  className: 'bg-gray-100 text-gray-700 border-gray-200',
};

export function CampaignStatusBadge({
  status,
  className,
}: CampaignStatusBadgeProps) {
  const config = statusConfig[status] || {
    ...defaultConfig,
    label: status,
  };

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
