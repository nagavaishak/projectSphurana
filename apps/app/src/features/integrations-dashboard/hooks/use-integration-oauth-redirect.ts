import { parseMetaAdsWizardSession } from '@/features/integrations/components';
import type { MetaAdsWizardSession } from '@/features/integrations/types';
import { type AppQueryKey, queryKeys } from '@/lib/query-keys';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Supported integration types that can have OAuth redirects with wizard flows.
 * Add new integration types here as they're implemented.
 */
export type OAuthIntegrationType =
  | 'meta-ads'
  | 'whatsapp'
  | 'google-calendar'
  | 'gmail'
  | 'outlook'
  | 'calendar'
  | 'calendly'
  | 'timely';

/**
 * Status values that can come from OAuth redirects
 */
export type OAuthRedirectStatus =
  | 'wizard'
  | 'success'
  | 'error'
  | 'connected'
  | 'select';

/**
 * Union type of all possible wizard session data.
 * Add new session types here as integrations are added.
 * @deprecated Session data is now stored in DB, use integrationId instead
 */
export type WizardSessionData = {
  type: 'meta-ads';
  data: MetaAdsWizardSession;
};
// Future: | { type: 'whatsapp'; data: WhatsAppWizardSession }

/**
 * Active wizard state - tracks which wizard is open and its session data
 */
export interface ActiveWizard {
  integration: OAuthIntegrationType;
  status: OAuthRedirectStatus;
  /** @deprecated Use integrationId instead */
  session: WizardSessionData | null;
  /** Integration ID for the new flow (data fetched from DB) */
  integrationId: string | null;
}

export interface UseIntegrationOAuthRedirectReturn {
  /** Currently active wizard (if any) */
  activeWizard: ActiveWizard | null;
  /** Close the active wizard */
  closeWizard: () => void;
  /** Called when wizard completes successfully - invalidates queries and closes */
  onWizardSuccess: () => void;
  /** Called when wizard is cancelled */
  onWizardCancel: () => void;
  /** Integration type that was just connected (status=connected), for auto-opening dialogs */
  justConnectedIntegration: OAuthIntegrationType | null;
  /** Clear the justConnectedIntegration state */
  clearJustConnected: () => void;
}

/**
 * Parses session data based on integration type
 */
function parseSessionData(
  integrationType: OAuthIntegrationType,
  sessionParam: string | null
): WizardSessionData | null {
  if (!sessionParam) return null;

  switch (integrationType) {
    case 'meta-ads': {
      const data = parseMetaAdsWizardSession(sessionParam);
      return data ? { type: 'meta-ads', data } : null;
    }
    // Add more integrations here:
    // case 'whatsapp': {
    //   const data = parseWhatsAppWizardSession(sessionParam);
    //   return data ? { type: 'whatsapp', data } : null;
    // }
    default:
      return null;
  }
}

/**
 * Returns the query keys to invalidate when a wizard completes.
 *
 * These were raw arrays until the query-key gate landed, and one of them —
 * `['calendar-accounts']` — was a root NO query has ever defined, so half of
 * what a Google Calendar connect claimed to refresh was a silent no-op.
 */
function getQueryKeysToInvalidate(
  integrationType: OAuthIntegrationType
): AppQueryKey[] {
  switch (integrationType) {
    case 'meta-ads':
      return [
        queryKeys.integrations.metaAdsIntegration(),
        queryKeys.integrations.metaAdsPages(),
      ];
    case 'whatsapp':
      return [queryKeys.integrations.whatsappAccounts()];
    case 'google-calendar':
    case 'calendar':
      return [queryKeys.integrations.calendarAccounts()];
    case 'gmail':
    case 'outlook':
      return [queryKeys.integrations.emailAccounts()];
    case 'calendly':
    case 'timely':
      return [
        queryKeys.externalTeamMembers.all(),
        queryKeys.integrations.bookingAccounts(),
      ];
    default:
      return [];
  }
}

/**
 * Hook to handle OAuth redirects for integrations.
 *
 * This hook:
 * 1. Reads URL params on mount to detect OAuth redirects
 * 2. Parses the session data for the specific integration type
 * 3. Manages wizard open/close state
 * 4. Invalidates relevant queries when wizard completes
 *
 * URL param format: ?integration={type}&status={status}&session={base64-encoded-data}
 *
 * @example
 * ```tsx
 * const { activeWizard, onWizardSuccess, onWizardCancel } = useIntegrationOAuthRedirect();
 *
 * return (
 *   <>
 *     {activeWizard?.integration === 'meta-ads' && (
 *       <MetaAdsWizardModal
 *         open={true}
 *         sessionData={activeWizard.session?.data}
 *         onSuccess={onWizardSuccess}
 *         onCancel={onWizardCancel}
 *       />
 *     )}
 *   </>
 * );
 * ```
 */
export function useIntegrationOAuthRedirect(): UseIntegrationOAuthRedirectReturn {
  const [activeWizard, setActiveWizard] = useState<ActiveWizard | null>(null);
  const [justConnectedIntegration, setJustConnectedIntegration] =
    useState<OAuthIntegrationType | null>(null);
  const queryClient = useQueryClient();

  // Parse URL params on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const urlParams = new URLSearchParams(window.location.search);
    const integration = urlParams.get(
      'integration'
    ) as OAuthIntegrationType | null;
    const status = urlParams.get('status') as OAuthRedirectStatus | null;
    const session = urlParams.get('session'); // Legacy: base64 encoded session data
    const integrationId = urlParams.get('integrationId'); // New: just the ID
    const errorMessage = urlParams.get('message');

    // Validate we have the required params
    if (!integration || !status) return;

    // Clear URL params to prevent re-triggering on refresh
    const url = new URL(window.location.href);
    url.searchParams.delete('integration');
    url.searchParams.delete('status');
    url.searchParams.delete('session');
    url.searchParams.delete('integrationId');
    url.searchParams.delete('message');
    window.history.replaceState({}, '', url.toString());

    // Handle error status
    if (status === 'error') {
      toast.error(errorMessage || `Failed to connect ${integration}`);
      return;
    }

    // Handle simple integrations that don't need a wizard (connected status)
    if (status === 'connected') {
      // Invalidate queries for this integration type
      const keysToInvalidate = getQueryKeysToInvalidate(integration);
      for (const key of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: key });
      }

      // Show success toast
      const integrationName =
        integration.charAt(0).toUpperCase() + integration.slice(1);
      toast.success(`${integrationName} connected successfully`);

      // Signal which integration was just connected (for auto-opening dialogs)
      setJustConnectedIntegration(integration);
      return;
    }

    // For wizard-based integrations, parse session data and set active wizard
    // New flow: integrationId is provided, data will be fetched from DB
    // Legacy flow: session data is provided as base64 encoded string
    const sessionData = session ? parseSessionData(integration, session) : null;

    // Set active wizard
    setActiveWizard({
      integration,
      status,
      session: sessionData,
      integrationId: integrationId || null,
    });
  }, [queryClient]);

  const closeWizard = () => {
    setActiveWizard(null);
  };

  const onWizardSuccess = () => {
    if (activeWizard) {
      // Invalidate relevant queries
      const keysToInvalidate = getQueryKeysToInvalidate(
        activeWizard.integration
      );
      for (const key of keysToInvalidate) {
        queryClient.invalidateQueries({ queryKey: key });
      }
    }
    closeWizard();
  };

  const onWizardCancel = () => {
    closeWizard();
  };

  const clearJustConnected = () => {
    setJustConnectedIntegration(null);
  };

  return {
    activeWizard,
    closeWizard,
    onWizardSuccess,
    onWizardCancel,
    justConnectedIntegration,
    clearJustConnected,
  };
}
