import { FieldGroup } from '@/components/ui/field';
import {
  IntegrationCard,
  IntegrationCardList,
} from '@/components/ui/integration-card';
import { IntegrationLinkButton } from '@/components/ui/integration-link-button';
import {
  useDisconnectMetaIntegration,
  useGetMetaIntegration,
  useInitiateMetaAdsAuth,
} from '@/features/integrations';
import { CheckCircle2, Megaphone } from 'lucide-react';
import { useEffect } from 'react';
import type { UseFormReturn } from 'react-hook-form';

// Meta/Facebook icon
const MetaIcon = () => (
  <svg
    className="size-5"
    viewBox="0 0 24 24"
    fill="none"
    aria-labelledby="meta-icon-title"
  >
    <title id="meta-icon-title">Meta</title>
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#1877F2" />
    <path
      d="M16.5 12.5C16.5 9.46 14.04 7 11 7C7.96 7 5.5 9.46 5.5 12.5C5.5 15.26 7.52 17.54 10.16 17.94V14.31H8.57V12.5H10.16V11.12C10.16 9.55 11.09 8.69 12.53 8.69C13.21 8.69 13.93 8.81 13.93 8.81V10.35H13.14C12.37 10.35 12.13 10.83 12.13 11.32V12.5H13.86L13.58 14.31H12.13V17.94C14.77 17.54 16.79 15.26 16.79 12.5H16.5Z"
      fill="white"
    />
  </svg>
);

// Session storage key for integrations context
const INTEGRATIONS_META_OAUTH_KEY = 'borradh_integrations_meta_oauth';

interface Step4MetaProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
}

export function Step4Meta({ organizationId }: Step4MetaProps) {
  // OAuth initiation hook - redirects to setup page after auth
  const { authUrl, initiateAuth } = useInitiateMetaAdsAuth({
    returnTo: '/connect/meta-ads',
  });

  // Fetch connected Meta integration - only when org exists
  const { integration, isConnected, isLoading } = useGetMetaIntegration({
    queryConfig: { enabled: !!organizationId },
  });

  // Disconnect hook
  const { disconnect, isDisconnecting } = useDisconnectMetaIntegration();

  // Check for pending OAuth on mount (from sessionStorage) and redirect to setup page
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const integrationParam = urlParams.get('integration');
      const status = urlParams.get('status');

      // If OAuth redirected here with wizard status, redirect to setup page
      if (integrationParam === 'meta-ads' && status === 'wizard') {
        window.location.href = '/connect/meta-ads';
        return;
      }

      // Clean up integrations oauth flag if we're back
      sessionStorage.removeItem(INTEGRATIONS_META_OAUTH_KEY);
    }
  }, []);

  const handleMetaConnect = () => {
    // Store flag that we're in integrations flow
    sessionStorage.setItem(INTEGRATIONS_META_OAUTH_KEY, 'true');
    // Redirect to OAuth using the hook — will land on setup page after auth
    initiateAuth();
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
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Connect Meta Ads</h1>
        <p className="text-sm text-muted-foreground">
          Link your Facebook/Meta ad account to run AI-powered advertising
          campaigns. This allows the AI to create and manage ads on your behalf.
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
            authUrl={authUrl}
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
  );
}

/**
 * Check if there's a pending Meta Ads OAuth from integrations funnel
 * Used by dashboard to redirect back to integrations
 */
export function checkIntegrationsMetaOAuth(): boolean {
  if (typeof window === 'undefined') return false;
  return sessionStorage.getItem(INTEGRATIONS_META_OAUTH_KEY) === 'true';
}
