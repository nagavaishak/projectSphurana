import { FieldGroup } from '@/components/ui/field';
import {
  IntegrationCard,
  IntegrationCardList,
} from '@/components/ui/integration-card';
import { IntegrationLinkButton } from '@/components/ui/integration-link-button';
import {
  MetaAdsWizardModal,
  parseMetaAdsWizardSession,
  useDisconnectMetaIntegration,
  useGetMetaIntegration,
} from '@/features/integrations';
import type { MetaAdsWizardSession } from '@/features/integrations';
import { openIntegrationOAuth } from '@/lib/open-integration-oauth';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { CheckCircle2, Megaphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { UseFormReturn } from 'react-hook-form';

// Meta/Facebook icon
const MetaIcon = () => (
  <svg className="size-5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <title>Meta</title>
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#1877F2" />
    <path
      d="M16.5 12.5C16.5 9.46 14.04 7 11 7C7.96 7 5.5 9.46 5.5 12.5C5.5 15.26 7.52 17.54 10.16 17.94V14.31H8.57V12.5H10.16V11.12C10.16 9.55 11.09 8.69 12.53 8.69C13.21 8.69 13.93 8.81 13.93 8.81V10.35H13.14C12.37 10.35 12.13 10.83 12.13 11.32V12.5H13.86L13.58 14.31H12.13V17.94C14.77 17.54 16.79 15.26 16.79 12.5H16.5Z"
      fill="white"
    />
  </svg>
);

// Session storage key for onboarding context
const ONBOARDING_META_OAUTH_KEY = 'borradh_onboarding_meta_oauth';

interface Step9MetaProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
  /** Session data from URL params (passed from parent after OAuth redirect) */
  wizardSessionData?: MetaAdsWizardSession | null;
  /** Callback to clear wizard session after use */
  onWizardComplete?: () => void;
}

export function Step9Meta({
  organizationId,
  wizardSessionData,
  onWizardComplete,
}: Step9MetaProps) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [localSessionData, setLocalSessionData] =
    useState<MetaAdsWizardSession | null>(null);

  // Fetch connected Meta integration - only when org exists
  const { integration, isConnected, isLoading, refetch } =
    useGetMetaIntegration({
      queryConfig: { enabled: !!organizationId },
    });

  // Disconnect hook
  const { disconnect, isDisconnecting } = useDisconnectMetaIntegration();

  // Handle wizard session data from props (URL params)
  useEffect(() => {
    if (wizardSessionData) {
      setLocalSessionData(wizardSessionData);
      setWizardOpen(true);
    }
  }, [wizardSessionData]);

  // Check for pending OAuth on mount (from sessionStorage)
  useEffect(() => {
    // Check URL params for meta ads wizard session
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const integration = urlParams.get('integration');
      const status = urlParams.get('status');
      const session = urlParams.get('session');

      if (integration === 'meta-ads' && status === 'wizard' && session) {
        const parsedSession = parseMetaAdsWizardSession(session);
        if (parsedSession) {
          setLocalSessionData(parsedSession);
          setWizardOpen(true);
          // Clear URL params
          const url = new URL(window.location.href);
          url.searchParams.delete('integration');
          url.searchParams.delete('status');
          url.searchParams.delete('session');
          window.history.replaceState({}, '', url.toString());
        }
      }

      // Clean up onboarding oauth flag if we're back
      sessionStorage.removeItem(ONBOARDING_META_OAUTH_KEY);
    }
  }, []);

  const handleMetaConnect = () => {
    // Store flag that we're in onboarding flow
    sessionStorage.setItem(ONBOARDING_META_OAUTH_KEY, 'true');
    // Redirect to OAuth
    void openIntegrationOAuth('integrations/meta-ads/auth');
  };

  const handleWizardSuccess = () => {
    setWizardOpen(false);
    setLocalSessionData(null);
    refetch();
    onWizardComplete?.();
  };

  const handleWizardCancel = () => {
    setWizardOpen(false);
    setLocalSessionData(null);
    onWizardComplete?.();
  };

  // No org yet - show informational UI
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Connect Meta Ads</h1>
          <p className="text-sm text-muted-foreground">
            Link your Facebook/Meta ad account to run AI-powered advertising
            campaigns. This allows the AI to create and manage ads on your
            behalf.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <Megaphone className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Meta Ads integration will be available after your organization is
            created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can skip this step and set it up later in Settings.
          </p>
        </div>
      </FieldGroup>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Connect Meta Ads</h1>
          <p className="text-sm text-muted-foreground">
            Checking your Meta Ads connection...
          </p>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-16 rounded-lg bg-muted" />
        </div>
      </FieldGroup>
    );
  }

  return (
    <>
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Connect Meta Ads</h1>
          <p className="text-sm text-muted-foreground">
            Link your Facebook/Meta ad account to run AI-powered advertising
            campaigns. This allows the AI to create and manage ads on your
            behalf.
          </p>
        </div>

        {/* Connected Meta Account */}
        {isConnected && integration && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-green-500" />
              <p className="text-sm font-medium">Connected Account</p>
            </div>
            <IntegrationCardList>
              <IntegrationCard
                id={integration.id}
                provider="meta_ads"
                title={
                  integration.adAccountName ||
                  integration.adAccountId ||
                  'Meta Ads'
                }
                subtitle={integration.defaultPage?.pageName || 'Meta Ads'}
                isActive={integration.isActive}
                icon={<MetaIcon />}
                onDisconnect={() => disconnect()}
                isDisconnecting={isDisconnecting}
              />
            </IntegrationCardList>

            {/* Show additional details */}
            <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <span className="font-medium">Ad Account:</span>{' '}
                  {integration.adAccountName || integration.adAccountId}
                </div>
                <div>
                  <span className="font-medium">Page:</span>{' '}
                  {integration.defaultPage?.pageName ||
                    integration.defaultPage?.pageId ||
                    'No page connected'}
                </div>
                {integration.defaultPage?.pixelId && (
                  <div className="col-span-2">
                    <span className="font-medium">Pixel:</span>{' '}
                    {integration.defaultPage.pixelName ||
                      integration.defaultPage.pixelId}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Connect Meta Ads Button */}
        {!isConnected && (
          <div className="space-y-3">
            <p className="text-sm font-medium">Connect your Meta account</p>

            <IntegrationLinkButton
              provider="meta_ads"
              label="Meta Ads (Facebook)"
              description="Connect your Facebook Ad Account and Page"
              icon={<MetaIcon />}
              authUrl={resolveApiUrl('integrations/meta-ads/auth')}
              isConnected={false}
              onConnect={handleMetaConnect}
            />

            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-200">
              <p className="font-medium">What you&apos;ll need:</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                <li>A Facebook Business account</li>
                <li>An active Ad Account</li>
                <li>A Facebook Page for your business</li>
              </ul>
            </div>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          You can skip this step and connect Meta Ads later in your organization
          settings.
        </p>
      </FieldGroup>

      {/* Meta Ads Wizard Modal */}
      <MetaAdsWizardModal
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        sessionData={localSessionData}
        onSuccess={handleWizardSuccess}
        onCancel={handleWizardCancel}
      />
    </>
  );
}

/**
 * Check if there's a pending Meta Ads OAuth from onboarding
 * Used by dashboard to redirect back to onboarding
 */
export function checkOnboardingMetaOAuth(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(ONBOARDING_META_OAUTH_KEY) === 'true';
}
