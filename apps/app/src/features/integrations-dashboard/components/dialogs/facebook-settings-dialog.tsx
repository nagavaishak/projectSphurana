import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToggleInstagramChatbot } from '@/features/integrations/api';
import { Facebook, Instagram } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { IntegrationSettingsDialog } from './integration-settings-dialog';

interface ConnectedProfile {
  name: string | null;
  email?: string | null;
  pictureUrl: string | null;
}

interface FacebookSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (data: {
    pageIds: string[];
    adAccountIds: string[];
  }) => void;
  onDisconnect?: () => void;
  defaultValues?: {
    pageIds?: string[];
    adAccountIds?: string[];
  };
  pages?: { id: string; name: string }[];
  adAccounts?: { id: string; name: string }[];
  facebookProfile?: ConnectedProfile | null;
  /**
   * Present when the combined "Facebook & Instagram" card is active and an
   * Instagram account is linked to the connected Page. Surfaces the linked IG
   * identity + its OWN (per-channel) chatbot toggle, independent of Messenger.
   */
  instagram?: {
    username: string | null;
    name: string | null;
    chatbotEnabled: boolean;
  } | null;
}

export function FacebookSettingsDialog({
  open,
  onOpenChange,
  onSave,
  onDisconnect,
  defaultValues,
  pages = [],
  adAccounts = [],
  facebookProfile,
  instagram,
}: FacebookSettingsDialogProps) {
  const [selectedPage, setSelectedPage] = useState(
    defaultValues?.pageIds?.[0] ?? ''
  );
  const [selectedAdAccount, setSelectedAdAccount] = useState(
    defaultValues?.adAccountIds?.[0] ?? ''
  );

  const [igChatbotEnabled, setIgChatbotEnabled] = useState(
    instagram?.chatbotEnabled ?? false
  );
  useEffect(() => {
    setIgChatbotEnabled(instagram?.chatbotEnabled ?? false);
  }, [instagram?.chatbotEnabled]);

  // NOTE (flfb follow-up): the enable/disable endpoint writes
  // instagram_integration.chatbot_enabled today. For page-linked-only orgs
  // (no standalone integration row) this toggle needs the flag moved onto
  // meta_ads_page — tracked with the IG-on-FLfB migration.
  const { toggleInstagramChatbot, isToggling: isTogglingIg } =
    useToggleInstagramChatbot();

  const handleToggleIgChatbot = (checked: boolean) => {
    setIgChatbotEnabled(checked); // optimistic flip
    toggleInstagramChatbot(
      { enabled: checked },
      {
        onSuccess: () => {
          setIgChatbotEnabled(checked);
          toast.success(
            checked ? 'Instagram chatbot enabled' : 'Instagram chatbot disabled'
          );
        },
        onError: (error: Error) => {
          setIgChatbotEnabled(!checked); // revert optimistic flip
          toast.error(error.message || 'Failed to update Instagram chatbot');
        },
      }
    );
  };

  const handleSave = () => {
    onSave?.({
      pageIds: selectedPage ? [selectedPage] : [],
      adAccountIds: selectedAdAccount ? [selectedAdAccount] : [],
    });
  };

  return (
    <IntegrationSettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Facebook"
      icon={<img src="/fb-icon.svg" alt="Facebook" className="size-10" />}
      onSave={handleSave}
      onDisconnect={onDisconnect}
    >
      {/* Connected Profile */}
      {facebookProfile?.name && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-9">
              {facebookProfile.pictureUrl && (
                <AvatarImage
                  src={facebookProfile.pictureUrl}
                  alt={facebookProfile.name}
                />
              )}
              <AvatarFallback>
                <Facebook className="size-4" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {facebookProfile.name}
              </p>
              {facebookProfile.email && (
                <p className="truncate text-xs text-muted-foreground">
                  {facebookProfile.email}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      <Field>
        <FieldLabel>Connected Pages</FieldLabel>
        <Select value={selectedPage} onValueChange={setSelectedPage}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select pages" />
          </SelectTrigger>
          <SelectContent>
            {pages.map((page) => (
              <SelectItem key={page.id} value={page.id}>
                {page.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Connected Ad Accounts</FieldLabel>
        <Select value={selectedAdAccount} onValueChange={setSelectedAdAccount}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select ad accounts" />
          </SelectTrigger>
          <SelectContent>
            {adAccounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* Instagram (linked to the connected Page) — per-channel controls, kept
          separate from Messenger so "disabled stays disabled". */}
      {instagram && (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Avatar className="size-9">
              <AvatarFallback>
                <Instagram className="size-4" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {instagram.username
                  ? `@${instagram.username}`
                  : (instagram.name ?? 'Instagram')}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                Connected via your Facebook Page
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">Instagram chatbot</p>
              <p className="text-xs text-muted-foreground">
                Auto-reply to Instagram DMs. Independent of Messenger.
              </p>
            </div>
            <Switch
              checked={igChatbotEnabled}
              disabled={isTogglingIg}
              onCheckedChange={handleToggleIgChatbot}
              aria-label="Toggle Instagram chatbot"
            />
          </div>
        </div>
      )}
    </IntegrationSettingsDialog>
  );
}
