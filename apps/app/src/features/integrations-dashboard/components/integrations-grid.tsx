import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  type IntegrationProvider,
  IntegrationProviderCard,
  IntegrationProviderGrid,
  type IntegrationStatus,
} from '@/components/ui/integration-provider-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDisconnectCalendarAccount,
  useDisconnectEmailAccount,
  useDisconnectInstagramIntegration,
  useDisconnectMetaIntegration,
  useDisconnectWhatsAppAccount,
  useGetInstagramIntegration,
  useGetMetaIntegration,
  useInitiateGoogleCalendarAuth,
  useInitiateMetaAdsAuth,
  useListCalendarAccounts,
  useListEmailAccounts,
  useListMetaAdsPages,
  useListWhatsAppAccounts,
} from '@/features/integrations/api';
import { useMetaLoginForBusiness } from '@/features/integrations/hooks/use-meta-login-for-business';
import { useWhatsAppEmbeddedSignup } from '@/features/integrations/hooks/use-whatsapp-embedded-signup';
import {
  openIntegrationOAuth,
  startIntegrationOAuth,
} from '@/lib/open-integration-oauth';
import { useNavigate } from '@tanstack/react-router';
import { AlertTriangle } from 'lucide-react';
import { useFeatureFlagEnabled } from 'posthog-js/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useIntegrationOAuthRedirect } from '../hooks/use-integration-oauth-redirect';
import {
  FacebookSettingsDialog,
  GmailSettingsDialog,
  GoogleCalendarSettingsDialog,
  InstagramSettingsDialog,
  OutlookCalendarSettingsDialog,
  PayPalSettingsDialog,
  StripeSettingsDialog,
  WhatsAppSettingsDialog,
} from './dialogs';
import { InstagramChatbotDialog } from './dialogs/instagram-chatbot-dialog';
import { IntegrationWizards } from './integration-wizards';
import { WhatsAppHealthBanner } from './whatsapp-health-banner';

// Base provider data (without status - status is determined from API)
const baseProviders: Omit<IntegrationProvider, 'status'>[] = [
  // {
  //   id: 'gmail',
  //   name: 'Gmail',
  //   description:
  //     'Send emails directly from your Gmail account to communicate with leads.',
  //   iconFile: 'gmail-icon.svg',
  //   category: 'messaging',
  // },
  {
    id: 'facebook',
    name: 'Facebook',
    description:
      'Connect your Facebook account to run ads and manage social engagement.',
    iconFile: 'fb-icon.svg',
    category: 'social',
    isRecommended: true,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    description:
      'Publish content and manage messages on your Instagram account.',
    iconFile: 'ig-icon.svg',
    category: 'social',
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    description:
      'Connect your WhatsApp Business account to chat with leads and customers.',
    iconFile: 'wa-icon.svg',
    category: 'messaging',
  },
  // {
  //   id: 'google-calendar',
  //   name: 'Google Calendar',
  //   description:
  //     'Sync appointments and availability to automatically manage your schedule.',
  //   iconFile: 'google-calendar-icon.svg',
  //   category: 'calendar',
  // },
];

type DialogType =
  | 'gmail'
  | 'facebook'
  | 'instagram'
  | 'whatsapp'
  | 'google-calendar'
  | 'outlook-calendar'
  | 'stripe'
  | 'paypal'
  | null;

interface IntegrationsGridProps {
  onConnect?: (providerId: string) => void;
  onEdit?: (providerId: string) => void;
}

export function IntegrationsGrid({ onConnect, onEdit }: IntegrationsGridProps) {
  const [openDialog, setOpenDialog] = useState<DialogType>(null);
  const navigate = useNavigate();

  // Handle OAuth redirects (wizard sessions from URL params)
  const oauthRedirect = useIntegrationOAuthRedirect();

  // Fetch integration data from API
  const { accounts: emailAccounts, isLoading: isLoadingEmail } =
    useListEmailAccounts();
  const { accounts: calendarAccounts, isLoading: isLoadingCalendar } =
    useListCalendarAccounts();
  const {
    integration: metaIntegration,
    isLoading: isLoadingMeta,
    isPendingConfiguration: isMetaPendingConfiguration,
    needsReconnect: metaNeedsReconnect,
    availableAdAccounts: metaAvailableAdAccounts,
    availablePages: metaAvailablePages,
  } = useGetMetaIntegration();
  const {
    integration: instagramIntegration,
    isLoading: isLoadingInstagram,
    needsReconnect: instagramNeedsReconnect,
  } = useGetInstagramIntegration();
  const { accounts: whatsappAccounts, isLoading: isLoadingWhatsApp } =
    useListWhatsAppAccounts();
  const { pages: metaPagesList } = useListMetaAdsPages();
  const hasFacebookPage = useMemo(
    () => metaPagesList.some((p) => p.platform === 'facebook'),
    [metaPagesList]
  );
  // Disconnect hooks
  const { disconnect: disconnectEmail } = useDisconnectEmailAccount();
  const { disconnect: disconnectCalendar } = useDisconnectCalendarAccount();
  const { disconnect: disconnectMeta } = useDisconnectMetaIntegration();
  const { disconnect: disconnectInstagram } =
    useDisconnectInstagramIntegration();
  const { disconnect: disconnectWhatsApp } = useDisconnectWhatsAppAccount();

  // OAuth initiation hooks
  const { initiateAuth: initiateGoogleCalendarAuth } =
    useInitiateGoogleCalendarAuth({
      returnTo: '/dashboard/settings/integrations',
    });
  const { initiateAuth: initiateMetaAdsAuth } = useInitiateMetaAdsAuth({
    returnTo: '/dashboard/settings/integrations',
  });
  const { launch: launchWhatsAppSignup } = useWhatsAppEmbeddedSignup();

  // Gradual migration: when on, Facebook + Instagram connect via the Facebook
  // Login for Business popup (one config covering FB Pages, ads, and IG)
  // instead of the classic redirect OAuth. Undefined/false → old path.
  const metaFlfbEnabled = useFeatureFlagEnabled('meta-flfb-login');
  const { launch: launchMetaLogin } = useMetaLoginForBusiness({
    // FLfB auto-configures every page server-side — no selection wizard.
    onSuccess: () => navigate({ to: '/dashboard/settings/integrations' }),
  });

  // NO combined "Facebook & Instagram" card. It rested on a premise that is
  // false: that one Login for Business configuration covers Pages, ads AND
  // Instagram. It does not — the FLfB config carries the `instagram_*` family,
  // which Meta REFUSED at app review, while Instagram actually runs on the
  // `instagram_business_*` family through Instagram Login. Two products, two
  // reviews, two flows.
  //
  // The bug that hid behind it: the card keyed off `metaIntegration?.isFlfb`,
  // so ANY org on an FLfB connection silently collapsed to a single card whose
  // only action launches the FLfB popup — a popup that cannot grant Instagram.
  // Those orgs had no way to connect Instagram at all, and nothing said so.
  // No flag was needed to trigger it, which is why it survived unnoticed.

  const isLoading =
    isLoadingEmail ||
    isLoadingCalendar ||
    isLoadingMeta ||
    isLoadingInstagram ||
    isLoadingWhatsApp;

  // Auto-open Google Calendar settings dialog after OAuth redirect
  useEffect(() => {
    const connected = oauthRedirect.justConnectedIntegration;
    if (
      (connected === 'calendar' || connected === 'google-calendar') &&
      calendarAccounts.length > 0
    ) {
      setOpenDialog('google-calendar');
      oauthRedirect.clearJustConnected();
    }
  }, [
    oauthRedirect.justConnectedIntegration,
    oauthRedirect.clearJustConnected,
    calendarAccounts,
  ]);

  // Helper to get Gmail accounts only
  const gmailAccounts = useMemo(
    () => emailAccounts.filter((a) => a.provider === 'gmail'),
    [emailAccounts]
  );

  // Helper to get Outlook accounts (for Outlook Calendar)
  const outlookAccounts = useMemo(
    () => emailAccounts.filter((a) => a.provider === 'outlook'),
    [emailAccounts]
  );

  // Compute provider status from API data
  const getProviderStatus = useCallback(
    (providerId: string): IntegrationStatus => {
      switch (providerId) {
        case 'gmail':
          return gmailAccounts.length > 0 ? 'connected' : 'disconnected';
        case 'facebook':
          if (metaNeedsReconnect) return 'needs_reconnect';
          if (isMetaPendingConfiguration) return 'pending_configuration';
          return metaIntegration ? 'connected' : 'disconnected';
        case 'instagram':
          if (instagramNeedsReconnect) return 'needs_reconnect';
          return instagramIntegration ? 'connected' : 'disconnected';
        case 'whatsapp': {
          if (whatsappAccounts.length === 0) return 'disconnected';
          const anyNeedsReconnect = whatsappAccounts.some(
            (a) =>
              a.tokenStatus === 'needs_reconnect' ||
              (a.tokenExpiresAt !== null &&
                new Date(a.tokenExpiresAt).getTime() <= Date.now())
          );
          return anyNeedsReconnect ? 'needs_reconnect' : 'connected';
        }
        case 'google-calendar':
          return calendarAccounts.length > 0 ? 'connected' : 'disconnected';
        case 'outlook-calendar':
          return outlookAccounts.length > 0 ? 'connected' : 'disconnected';
        default:
          return 'disconnected';
      }
    },
    [
      gmailAccounts,
      metaIntegration,
      metaNeedsReconnect,
      isMetaPendingConfiguration,
      instagramIntegration,
      instagramNeedsReconnect,
      whatsappAccounts,
      calendarAccounts,
      outlookAccounts,
    ]
  );

  // Facebook and Instagram stay SEPARATE cards, always. Each connects through
  // its own product, and folding them together makes one of the two
  // unreachable.
  const activeBaseProviders = baseProviders;

  // Build full providers list with dynamic status
  const integrationProviders: IntegrationProvider[] = useMemo(() => {
    return activeBaseProviders.map((provider) => ({
      ...provider,
      status: getProviderStatus(provider.id),
    }));
  }, [activeBaseProviders, getProviderStatus]);

  // OAuth redirect handlers
  const initiateGmailAuth = useCallback(() => {
    void openIntegrationOAuth(
      `integrations/email/auth/gmail?returnTo=${encodeURIComponent('/dashboard/settings/integrations')}`
    );
  }, []);

  const initiateOutlookAuth = useCallback(() => {
    void openIntegrationOAuth(
      `integrations/email/auth/outlook?returnTo=${encodeURIComponent('/dashboard/settings/integrations')}`
    );
  }, []);

  const handleConnect = (providerId: string) => {
    // Direct OAuth redirect for disconnected providers
    switch (providerId) {
      case 'gmail':
        initiateGmailAuth();
        break;
      case 'facebook':
        // If pending configuration, navigate to setup page
        if (isMetaPendingConfiguration) {
          navigate({ to: '/connect/meta-ads' });
        } else if (metaFlfbEnabled) {
          // Facebook Login for Business popup. The configuration covers the
          // Page, ads and leads — NOT Instagram. `instagram_content_publish`
          // was refused at app review, so IG stays on Instagram Login below,
          // which uses the approved `instagram_business_*` family.
          //
          // Preferred over classic OAuth because it mints a system-user token
          // in the CLIENT's business: no expiry, and it survives the
          // authorising person's password change, restriction, or departure.
          // Measured on live orgs: 0 failures in 31 on FLfB, 3 in 24 on
          // classic.
          launchMetaLogin();
        } else {
          // Both disconnected and needs_reconnect trigger classic OAuth
          initiateMetaAdsAuth();
        }
        break;
      case 'instagram':
        // Instagram stays on its own Instagram Login flow: the FB Login for
        // Business config does NOT carry the instagram_* permission family
        // (app-reviewed only for the instagram_business_* family), so IG is
        // not folded into the FLFB popup.
        void startIntegrationOAuth('integrations/instagram/authorize-url');
        break;
      case 'whatsapp':
        launchWhatsAppSignup();
        break;
      case 'google-calendar':
        initiateGoogleCalendarAuth();
        break;
      case 'outlook-calendar':
        initiateOutlookAuth();
        break;
      default:
        console.log(`Connect not implemented for: ${providerId}`);
    }
    onConnect?.(providerId);
  };

  const handleEdit = (providerId: string) => {
    // The combined card maps to the Facebook settings dialog.
    if (providerId === 'meta') {
      setOpenDialog('facebook');
      onEdit?.(providerId);
      return;
    }
    // Open settings dialog for connected providers
    const supportedDialogs: DialogType[] = [
      'gmail',
      'facebook',
      'instagram',
      'whatsapp',
      'google-calendar',
      'outlook-calendar',
      'stripe',
      'paypal',
    ];
    if (supportedDialogs.includes(providerId as DialogType)) {
      setOpenDialog(providerId as DialogType);
    }
    onEdit?.(providerId);
  };

  const handleDisconnect = (providerId: string, accountId?: string) => {
    switch (providerId) {
      case 'gmail':
        if (accountId) disconnectEmail(accountId);
        break;
      case 'facebook':
        disconnectMeta();
        break;
      case 'instagram':
        disconnectInstagram();
        break;
      case 'whatsapp':
        if (accountId) disconnectWhatsApp(accountId);
        break;
      case 'google-calendar':
        if (accountId) disconnectCalendar(accountId);
        break;
      case 'outlook-calendar':
        if (accountId) disconnectEmail(accountId);
        break;
    }
    setOpenDialog(null);
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((n) => (
            <Skeleton
              key={`integration-skeleton-${n}`}
              className="h-[220px] w-full"
            />
          ))}
        </div>
      </div>
    );
  }

  // Build reconnect banner data
  const whatsappNeedsReconnect = whatsappAccounts.some(
    (a) =>
      a.tokenStatus === 'needs_reconnect' ||
      (a.tokenExpiresAt !== null &&
        new Date(a.tokenExpiresAt).getTime() <= Date.now())
  );
  const reconnectItems: { name: string; onReconnect: () => void }[] = [];
  if (metaNeedsReconnect) {
    reconnectItems.push({
      name: 'Facebook',
      // Same choice as a first connect — this used to be hardcoded to classic
      // OAuth, so the orgs that MOST need a durable credential could never
      // reach FLfB. A connection in `needs_reconnect` is one whose user token
      // already died; handing it another user token repeats the failure on a
      // 60-day timer.
      onReconnect: () =>
        metaFlfbEnabled ? launchMetaLogin() : initiateMetaAdsAuth(),
    });
  }
  if (instagramNeedsReconnect) {
    reconnectItems.push({
      name: 'Instagram',
      onReconnect: () => {
        void startIntegrationOAuth('integrations/instagram/authorize-url');
      },
    });
  }
  if (whatsappNeedsReconnect) {
    reconnectItems.push({
      name: 'WhatsApp',
      onReconnect: () => launchWhatsAppSignup(),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* WhatsApp token expiring within 7 days (pre-expiry warning) */}
      <WhatsAppHealthBanner
        accounts={whatsappAccounts}
        onReconnect={launchWhatsAppSignup}
      />

      {/* Reconnect banner for expired tokens */}
      {reconnectItems.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Action required</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>
              {reconnectItems.length === 1
                ? `Your ${reconnectItems[0].name} connection has expired. Reconnect to resume publishing and messaging.`
                : `Your ${reconnectItems.map((i) => i.name).join(' and ')} connections have expired. Reconnect to resume publishing and messaging.`}
            </span>
            <div className="flex gap-2">
              {reconnectItems.map((item) => (
                <Button
                  key={item.name}
                  variant="outline"
                  size="sm"
                  onClick={item.onReconnect}
                >
                  Reconnect {item.name}
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Grid of integration cards */}
      <IntegrationProviderGrid>
        {integrationProviders.map((provider) => (
          <IntegrationProviderCard
            key={provider.id}
            provider={provider}
            onConnect={handleConnect}
            onEdit={handleEdit}
            disabledReason={
              provider.id === 'whatsapp' &&
              provider.status !== 'connected' &&
              !hasFacebookPage
                ? 'Connect a Facebook Page first'
                : undefined
            }
          />
        ))}
      </IntegrationProviderGrid>

      {/* Integration Settings Dialogs */}
      <GmailSettingsDialog
        open={openDialog === 'gmail'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => {
          const firstAccount = gmailAccounts[0];
          if (firstAccount) handleDisconnect('gmail', firstAccount.id);
        }}
        accounts={gmailAccounts.map((a) => ({ id: a.id, email: a.email }))}
        defaultValues={{
          accountId: gmailAccounts[0]?.id,
        }}
      />

      <FacebookSettingsDialog
        open={openDialog === 'facebook'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => handleDisconnect('facebook')}
        pages={
          metaIntegration?.pages
            ? metaIntegration.pages.map((p) => ({
                id: p.pageId,
                name: p.pageName ?? 'Connected Page',
              }))
            : []
        }
        adAccounts={
          metaIntegration?.adAccountId
            ? [
                {
                  id: metaIntegration.adAccountId,
                  name: metaIntegration.adAccountName ?? 'Connected Ad Account',
                },
              ]
            : []
        }
        defaultValues={{
          pageIds: metaIntegration?.pages?.map((p) => p.pageId) ?? [],
          adAccountIds: metaIntegration?.adAccountId
            ? [metaIntegration.adAccountId]
            : [],
        }}
        facebookProfile={
          metaIntegration?.facebookUserName
            ? {
                name: metaIntegration.facebookUserName,
                email: metaIntegration.facebookUserEmail,
                pictureUrl: metaIntegration.facebookUserPictureUrl,
              }
            : null
        }
        // Instagram has its own card and its own dialog again.
        instagram={null}
      />

      <InstagramSettingsDialog
        open={openDialog === 'instagram'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onDisconnect={() => handleDisconnect('instagram')}
        onReconnect={() => {
          setOpenDialog(null);
          void startIntegrationOAuth('integrations/instagram/authorize-url');
        }}
        integration={instagramIntegration}
      />

      <InstagramChatbotDialog />

      <WhatsAppSettingsDialog
        open={openDialog === 'whatsapp'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => {
          const firstAccount = whatsappAccounts[0];
          if (firstAccount) handleDisconnect('whatsapp', firstAccount.id);
        }}
        accounts={whatsappAccounts.map((a) => ({
          id: a.id,
          name: a.displayName || a.phoneNumber,
        }))}
        defaultValues={{
          accountId: whatsappAccounts[0]?.id,
          phoneNumber: whatsappAccounts[0]?.phoneNumber,
        }}
      />

      <GoogleCalendarSettingsDialog
        open={openDialog === 'google-calendar'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => {
          const firstAccount = calendarAccounts[0];
          if (firstAccount)
            handleDisconnect('google-calendar', firstAccount.id);
        }}
        accounts={calendarAccounts.map((a) => ({
          id: a.id,
          email: a.email,
        }))}
        calendars={calendarAccounts.map((a) => ({
          id: a.calendarId,
          name: a.displayName ?? 'Primary',
        }))}
        defaultValues={{
          accountId: calendarAccounts[0]?.id,
          calendarId: calendarAccounts[0]?.calendarId,
        }}
      />

      <OutlookCalendarSettingsDialog
        open={openDialog === 'outlook-calendar'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => {
          const firstAccount = outlookAccounts[0];
          if (firstAccount)
            handleDisconnect('outlook-calendar', firstAccount.id);
        }}
        accounts={outlookAccounts.map((a) => ({
          id: a.id,
          email: a.email,
        }))}
        calendars={[{ id: 'primary', name: 'Calendar' }]}
        defaultValues={{
          accountId: outlookAccounts[0]?.id,
        }}
      />

      <StripeSettingsDialog
        open={openDialog === 'stripe'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => setOpenDialog(null)}
        accounts={[]}
      />

      <PayPalSettingsDialog
        open={openDialog === 'paypal'}
        onOpenChange={(open) => !open && setOpenDialog(null)}
        onSave={() => setOpenDialog(null)}
        onDisconnect={() => setOpenDialog(null)}
        accounts={[]}
        emails={[]}
      />

      {/* OAuth redirect wizards */}
      <IntegrationWizards
        oauthRedirect={oauthRedirect}
        metaIntegration={metaIntegration}
        metaAvailableAdAccounts={metaAvailableAdAccounts}
        metaAvailablePages={metaAvailablePages}
        isLoadingMeta={isLoadingMeta}
      />
    </div>
  );
}
