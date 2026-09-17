import { Button } from '@/components/ui/button';
import { webAppUrl } from '@/lib/web-app-origin';
import { AlertTriangleIcon } from 'lucide-react';
import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  useCreateAccountLink,
  useGetAccountStatus,
  useRefreshAccountStatus,
} from '../api';

/**
 * Shows a reminder banner at the top of the sales section when a controller
 * account has outstanding requirements (contract §7.A). Actioning it redirects
 * to Stripe-hosted onboarding (not an embedded iframe). Renders nothing for
 * OAuth accounts or when nothing is due.
 */
export function SalesNotificationBanner() {
  const { status } = useGetAccountStatus();
  const { createAccountLinkAsync, isCreating } = useCreateAccountLink();
  const { refreshAccountStatus } = useRefreshAccountStatus();

  // Refresh live from Stripe when returning from hosted onboarding.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'return') {
      refreshAccountStatus();
      params.delete('stripe');
      const search = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`
      );
    }
  }, [refreshAccountStatus]);

  const shouldShow =
    status?.accountType === 'controller' &&
    (status?.requirementsCurrentlyDue?.length ?? 0) > 0;

  if (!shouldShow) return null;

  const startOnboarding = async () => {
    try {
      const base = webAppUrl(window.location.pathname);
      const { url } = await createAccountLinkAsync({ baseUrl: base });
      window.location.href = url;
    } catch {
      toast.error('Could not start Stripe onboarding. Please try again.');
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-amber-50 px-4 py-3 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="flex items-center gap-2 text-sm">
        <AlertTriangleIcon className="size-4 shrink-0" />
        <span>Additional details are required to keep accepting payments.</span>
      </div>
      <Button size="sm" onClick={startOnboarding} disabled={isCreating}>
        {isCreating ? 'Redirecting…' : 'Complete setup'}
      </Button>
    </div>
  );
}
