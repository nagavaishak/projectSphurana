import type {
  MetaAdAccountInfo,
  MetaAdsIntegration,
  MetaPageInfoStored,
} from '@/features/integrations/types';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { UseIntegrationOAuthRedirectReturn } from '../hooks/use-integration-oauth-redirect';

interface IntegrationWizardsProps {
  oauthRedirect: UseIntegrationOAuthRedirectReturn;
  /** Meta integration data from parent (avoids duplicate fetch) */
  metaIntegration: MetaAdsIntegration | null;
  metaAvailableAdAccounts: MetaAdAccountInfo[];
  metaAvailablePages: MetaPageInfoStored[];
  isLoadingMeta: boolean;
}

/**
 * Renders the appropriate wizard modal based on the OAuth redirect state.
 *
 * Add new wizard modals here as integrations are added.
 * Each integration type gets its own conditional render block.
 */
export function IntegrationWizards({
  oauthRedirect,
  metaIntegration,
  metaAvailableAdAccounts: _metaAvailableAdAccounts,
  metaAvailablePages: _metaAvailablePages,
  isLoadingMeta,
}: IntegrationWizardsProps) {
  const { activeWizard, onWizardSuccess, onWizardCancel } = oauthRedirect;
  const hasHandledStatus = useRef(false);

  // Handle error/success status in useEffect to avoid setState during render
  useEffect(() => {
    if (hasHandledStatus.current) return;

    if (activeWizard?.status === 'error') {
      hasHandledStatus.current = true;
      toast.error('Failed to connect integration. Please try again.');
      onWizardCancel();
      return;
    }

    if (activeWizard?.status === 'success') {
      hasHandledStatus.current = true;
      toast.success('Integration connected successfully!');
      onWizardSuccess();
      return;
    }
  }, [activeWizard?.status, onWizardCancel, onWizardSuccess]);

  // Reset the handled status when activeWizard changes
  useEffect(() => {
    if (!activeWizard) {
      hasHandledStatus.current = false;
    }
  }, [activeWizard]);

  // Handle integration data fetch error for meta-ads new flow
  const hasIntegrationId =
    activeWizard?.integration === 'meta-ads' && !!activeWizard?.integrationId;
  const integrationDataFailed =
    hasIntegrationId && !isLoadingMeta && !metaIntegration;

  useEffect(() => {
    if (integrationDataFailed && !hasHandledStatus.current) {
      hasHandledStatus.current = true;
      toast.error('Failed to load integration data. Please try again.');
      onWizardCancel();
    }
  }, [integrationDataFailed, onWizardCancel]);

  // No active wizard or not in wizard status, or already handled
  if (!activeWizard || activeWizard.status !== 'wizard') {
    return null;
  }

  // Still loading integration data for new flow
  if (hasIntegrationId && isLoadingMeta) {
    return null;
  }

  // Integration data failed - will be handled by useEffect
  if (integrationDataFailed) {
    return null;
  }

  // Render appropriate wizard based on integration type
  switch (activeWizard.integration) {
    case 'meta-ads': {
      // Redirect to full-page setup flow
      if (typeof window !== 'undefined') {
        window.location.href = '/connect/meta-ads';
      }
      onWizardCancel(); // Clean up wizard state
      return null;
    }

    // Add more integrations here:
    // case 'whatsapp': {
    //   const sessionData = activeWizard.session?.type === 'whatsapp'
    //     ? activeWizard.session.data
    //     : null;
    //   return (
    //     <WhatsAppWizardModal
    //       open={true}
    //       sessionData={sessionData}
    //       onSuccess={onWizardSuccess}
    //       onCancel={onWizardCancel}
    //     />
    //   );
    // }

    default:
      // Unknown integration type - log and ignore
      console.warn(
        `Unknown integration type for wizard: ${activeWizard.integration}`
      );
      return null;
  }
}
