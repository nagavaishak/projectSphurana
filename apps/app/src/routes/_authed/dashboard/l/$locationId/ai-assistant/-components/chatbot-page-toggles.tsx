import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { useListMetaAdsPages } from '@/features/integrations/api';
import { useGetInstagramIntegration } from '@/features/integrations/api';
import { useListWhatsAppAccounts } from '@/features/integrations/api';
import {
  useToggleInstagramChatbot,
  useTogglePageChatbot,
  useToggleWhatsappChatbot,
} from '@/features/integrations/api';
import { Facebook, Instagram, MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export function ChatbotPageToggles() {
  const {
    pages: allPages,
    isLoading: isLoadingPages,
    isError: isPagesError,
    refetch: refetchPages,
  } = useListMetaAdsPages();
  const {
    integration: igIntegration,
    isLoading: isLoadingIg,
    isError: isIgError,
  } = useGetInstagramIntegration();
  const {
    accounts: whatsappAccounts,
    isLoading: isLoadingWhatsApp,
    isError: isWhatsAppError,
  } = useListWhatsAppAccounts();
  const { togglePageChatbot, isToggling: isTogglingPage } =
    useTogglePageChatbot();
  const { toggleWhatsappChatbot, isToggling: isTogglingWhatsApp } =
    useToggleWhatsappChatbot();
  const { toggleInstagramChatbot, isToggling: isTogglingIg } =
    useToggleInstagramChatbot();

  const [pendingToggle, setPendingToggle] = useState<{
    pageId: string;
    pageName: string;
    enabling: boolean;
    type: 'meta' | 'instagram' | 'whatsapp';
  } | null>(null);

  // Only real Meta pages (not ig-standalone: virtual pages)
  const metaPages = allPages.filter((p) => !p.id.startsWith('ig-standalone:'));

  const handleConfirm = () => {
    if (!pendingToggle) return;

    if (pendingToggle.type === 'instagram') {
      toggleInstagramChatbot(
        { enabled: pendingToggle.enabling },
        {
          onSuccess: () => {
            toast.success(
              pendingToggle.enabling
                ? 'Instagram chatbot enabled'
                : 'Instagram chatbot disabled'
            );
          },
          onError: () => {
            toast.error('Failed to update Instagram chatbot');
          },
        }
      );
    } else if (pendingToggle.type === 'whatsapp') {
      toggleWhatsappChatbot({
        accountId: pendingToggle.pageId,
        enabled: pendingToggle.enabling,
      });
    } else {
      togglePageChatbot({
        pageId: pendingToggle.pageId,
        enabled: pendingToggle.enabling,
      });
    }
    setPendingToggle(null);
  };

  const isLoading = isLoadingPages || isLoadingIg || isLoadingWhatsApp;
  const isSaving = isTogglingPage || isTogglingWhatsApp || isTogglingIg;

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  const hasMetaPages = metaPages.length > 0;
  const hasInstagram = !!igIntegration?.isActive;
  const hasWhatsApp = whatsappAccounts.length > 0;

  // BEFORE the empty state. All three lists default to empty on a failed
  // request, so an org with Meta, Instagram and WhatsApp all connected was
  // told to go connect them — and, worse, saw no toggles, hiding whether
  // Claire is actually answering on those channels.
  if (isPagesError || isIgError || isWhatsAppError) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-destructive">
          Couldn&apos;t load your connected pages and accounts. This does not
          mean they&apos;re disconnected — the chatbot keeps running as
          configured.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetchPages()}>
          Try again
        </Button>
      </div>
    );
  }

  if (!hasMetaPages && !hasInstagram && !hasWhatsApp) {
    return (
      <p className="text-xs text-muted-foreground">
        No pages or accounts found. Connect Meta, Instagram, or WhatsApp in
        Integrations first.
      </p>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {hasInstagram && (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-2">
              <Instagram className="size-4 text-muted-foreground" />
              <span className="text-sm">
                {igIntegration.username || igIntegration.name || 'Instagram'}
              </span>
            </div>
            <Switch
              checked={igIntegration.chatbotEnabled}
              onCheckedChange={(checked) =>
                setPendingToggle({
                  pageId: 'instagram',
                  pageName:
                    igIntegration.username || igIntegration.name || 'Instagram',
                  enabling: checked,
                  type: 'instagram',
                })
              }
              disabled={isSaving}
              aria-label="Toggle chatbot for Instagram"
            />
          </div>
        )}

        {metaPages.map((page) => {
          const isEnabled = page.isChatbotActive;
          const Icon = page.platform === 'facebook' ? Facebook : Instagram;
          const name = page.pageName || page.pageId;

          return (
            <div
              key={page.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-sm">{name}</span>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) =>
                  setPendingToggle({
                    pageId: page.id,
                    pageName: name,
                    enabling: checked,
                    type: 'meta',
                  })
                }
                disabled={isSaving}
                aria-label={`Toggle chatbot for ${name}`}
              />
            </div>
          );
        })}

        {whatsappAccounts.map((account) => {
          const isEnabled = account.isChatbotActive;
          const name = account.displayName || account.phoneNumber;

          return (
            <div
              key={account.id}
              className="flex items-center justify-between rounded-lg border p-3"
            >
              <div className="flex items-center gap-2">
                <MessageCircle className="size-4 text-muted-foreground" />
                <span className="text-sm">{name}</span>
              </div>
              <Switch
                checked={isEnabled}
                onCheckedChange={(checked) =>
                  setPendingToggle({
                    pageId: account.id,
                    pageName: name,
                    enabling: checked,
                    type: 'whatsapp',
                  })
                }
                disabled={isSaving}
                aria-label={`Toggle chatbot for ${name}`}
              />
            </div>
          );
        })}
      </div>

      <Dialog
        open={!!pendingToggle}
        onOpenChange={(open) => !open && setPendingToggle(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingToggle?.enabling ? 'Enable' : 'Disable'} chatbot?
            </DialogTitle>
            <DialogDescription>
              {pendingToggle?.enabling
                ? `The chatbot will start responding to messages on ${pendingToggle.pageName}.`
                : `The chatbot will stop responding to messages on ${pendingToggle?.pageName}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingToggle(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirm}
              disabled={isSaving}
              variant={pendingToggle?.enabling ? 'default' : 'destructive'}
            >
              {isSaving
                ? 'Saving...'
                : pendingToggle?.enabling
                  ? 'Enable'
                  : 'Disable'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
