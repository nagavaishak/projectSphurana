import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useCoordinatedLoading } from '@/hooks/use-coordinated-loading';
import { Users, X } from 'lucide-react';
import { useState } from 'react';
import { useAcceptInvitation, useListPendingInvitations } from '../api';

export function PendingInvitationsBanner() {
  const { invitations, isLoading } = useListPendingInvitations();
  const { acceptInvitation, isAccepting } = useAcceptInvitation();
  const isPageReady = useCoordinatedLoading('pending-invitations', isLoading);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Filter out dismissed invitations
  const visibleInvitations = invitations.filter(
    (inv) => !dismissedIds.has(inv.id)
  );

  // Don't show anything if page isn't ready or no invitations
  if (!isPageReady || visibleInvitations.length === 0) {
    return null;
  }

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  const handleAccept = (id: string) => {
    acceptInvitation({ invitationId: id });
  };

  return (
    <div className="space-y-2">
      {visibleInvitations.map((invitation) => (
        <Alert key={invitation.id} className="relative pr-12">
          <Users className="h-4 w-4" />
          <AlertTitle>Team Invitation</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>
              {invitation.inviterName ?? 'Someone'} invited you to join{' '}
              <strong>{invitation.organizationName}</strong>
              {invitation.role && ` as ${invitation.role}`}.
            </span>
            <Button
              size="sm"
              onClick={() => handleAccept(invitation.id)}
              disabled={isAccepting}
            >
              {isAccepting ? 'Accepting...' : 'Accept'}
            </Button>
          </AlertDescription>
          <button
            type="button"
            className="absolute right-2 top-2 p-1 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            onClick={() => handleDismiss(invitation.id)}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Dismiss</span>
          </button>
        </Alert>
      ))}
    </div>
  );
}
