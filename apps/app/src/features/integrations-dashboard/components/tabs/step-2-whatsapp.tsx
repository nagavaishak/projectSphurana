import { FieldGroup } from '@/components/ui/field';
import {
  IntegrationCard,
  IntegrationCardList,
} from '@/components/ui/integration-card';
import { IntegrationLinkButton } from '@/components/ui/integration-link-button';
import {
  useDisconnectWhatsAppAccount,
  useListWhatsAppAccounts,
} from '@/features/integrations/api';
import { useWhatsAppEmbeddedSignup } from '@/features/integrations/hooks/use-whatsapp-embedded-signup';
import type { WhatsAppAccount } from '@/features/integrations/types';
import { MessageCircle, Phone } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

// WhatsApp icon component
const WhatsAppIcon = () => (
  <svg
    className="size-5"
    viewBox="0 0 24 24"
    fill="none"
    aria-labelledby="whatsapp-icon-title"
  >
    <title id="whatsapp-icon-title">WhatsApp</title>
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#25D366" />
    <path
      d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"
      fill="white"
    />
  </svg>
);

interface Step2WhatsAppProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
}

export function Step2WhatsApp({ organizationId }: Step2WhatsAppProps) {
  const { launch: initiateAuth, isReady, isBusy } = useWhatsAppEmbeddedSignup();

  // Fetch connected WhatsApp accounts
  const { accounts } = useListWhatsAppAccounts({
    queryConfig: { enabled: !!organizationId },
  });
  const { disconnect, isDisconnecting } = useDisconnectWhatsAppAccount();

  const hasWhatsApp = accounts.length > 0;

  // No org yet - show informational UI
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Link your WhatsApp</h1>
          <p className="text-sm text-muted-foreground">
            Connect WhatsApp Business to send automated messages to your leads
            as part of your follow-up sequences.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <MessageCircle className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            WhatsApp integration will be available after your organization is
            created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can skip this step and set it up later in Settings.
          </p>
        </div>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Link your WhatsApp</h1>
        <p className="text-sm text-muted-foreground">
          Connect WhatsApp Business to send automated messages to your leads as
          part of your follow-up sequences.
        </p>
      </div>

      {/* Connected WhatsApp Accounts */}
      {accounts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Connected WhatsApp Numbers</p>
          <IntegrationCardList>
            {accounts.map((account: WhatsAppAccount) => (
              <IntegrationCard
                key={account.id}
                id={account.id}
                provider="whatsapp"
                title={account.phoneNumber}
                subtitle={account.displayName || 'WhatsApp Business'}
                isActive={account.isActive}
                icon={<WhatsAppIcon />}
                onDisconnect={() => disconnect(account.id)}
                isDisconnecting={isDisconnecting}
              />
            ))}
          </IntegrationCardList>
        </div>
      )}

      {/* Connect Button */}
      <div className="space-y-3">
        {!hasWhatsApp && (
          <p className="text-sm font-medium">
            Connect your WhatsApp Business account
          </p>
        )}

        <IntegrationLinkButton
          provider="whatsapp"
          label={
            hasWhatsApp
              ? 'Add another WhatsApp number'
              : 'Connect WhatsApp Business'
          }
          description="Link your WhatsApp Business account via Facebook"
          icon={<WhatsAppIcon />}
          authUrl=""
          isConnected={false}
          isLoading={!isReady || isBusy}
          onConnect={initiateAuth}
        />
      </div>

      {/* Info Box */}
      <div className="rounded-lg border bg-muted/50 p-4">
        <div className="flex gap-3">
          <Phone className="size-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              WhatsApp Business Requirements
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5">
              <li>A Facebook Business account</li>
              <li>A WhatsApp Business API account (via Facebook)</li>
              <li>A verified phone number for WhatsApp Business</li>
            </ul>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        You can skip this step and set up WhatsApp later in your organization
        settings.
      </p>
    </FieldGroup>
  );
}
