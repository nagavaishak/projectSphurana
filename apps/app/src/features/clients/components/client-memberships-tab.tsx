import { format } from 'date-fns';
import { BadgeCheck, Infinity as InfinityIcon } from 'lucide-react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type LeadMembershipStatus,
  type LeadMembershipWithPlan,
  leadMembershipStatusLabels,
} from '@borradh-workspace/api-client/types';
import { useCancelMembership, useClientMemberships } from '../api';
import { formatMoney } from '../lib/format-money';

function statusVariant(
  status: LeadMembershipStatus
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'active':
      return 'default';
    case 'past_due':
      return 'secondary';
    case 'cancelled':
    case 'expired':
      return 'destructive';
    default:
      return 'outline';
  }
}

function MembershipCard({
  membership,
  leadId,
}: {
  membership: LeadMembershipWithPlan;
  leadId: string;
}) {
  const { cancelMembership, isCancelling } = useCancelMembership({ leadId });
  const canCancel =
    membership.status === 'active' || membership.status === 'past_due';

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium">{membership.plan.name}</p>
            <p className="text-sm text-muted-foreground">
              {formatMoney(
                membership.plan.priceCents,
                membership.plan.currency
              )}
            </p>
          </div>
          <Badge variant={statusVariant(membership.status)} className="text-xs">
            {leadMembershipStatusLabels[membership.status]}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-muted-foreground">Sessions remaining</p>
            <p className="flex items-center gap-1 font-medium">
              {membership.sessionsRemaining === null ? (
                <>
                  <InfinityIcon className="size-4" /> Unlimited
                </>
              ) : (
                membership.sessionsRemaining
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Valid until</p>
            <p className="font-medium">
              {membership.validUntil
                ? format(new Date(membership.validUntil), 'd MMM yyyy')
                : 'No expiry'}
            </p>
          </div>
        </div>

        {canCancel && (
          <div className="flex justify-end">
            <ConfirmDeleteDialog
              cancelLabel="Keep membership"
              confirmLabel="Cancel membership"
              description="Any recurring billing will stop and the client loses the benefits of this plan. This can’t be undone."
              isPending={isCancelling}
              onConfirm={() => cancelMembership(membership.id)}
              title={<>Cancel “{membership.plan.name}” for this client?</>}
              trigger={
                <Button disabled={isCancelling} size="sm" variant="outline">
                  Cancel membership
                </Button>
              }
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ClientMembershipsTab({ leadId }: { leadId: string }) {
  const { memberships, isLoading, isError } = useClientMemberships(leadId);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1].map((n) => (
          <Skeleton key={n} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Failed to load memberships.
      </p>
    );
  }

  if (memberships.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted-foreground">
        <BadgeCheck className="size-10 opacity-40" />
        <p className="text-sm">No memberships</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {memberships.map((membership) => (
        <MembershipCard
          key={membership.id}
          membership={membership}
          leadId={leadId}
        />
      ))}
    </div>
  );
}
