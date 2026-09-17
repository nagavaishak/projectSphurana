import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { IntegrationSettingsDialog } from './integration-settings-dialog';

interface WhatsAppSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (data: { accountId: string; phoneNumber: string }) => void;
  onDisconnect?: () => void;
  defaultValues?: {
    accountId?: string;
    phoneNumber?: string;
  };
  accounts?: { id: string; name: string }[];
}

export function WhatsAppSettingsDialog({
  open,
  onOpenChange,
  onSave,
  onDisconnect,
  defaultValues,
  accounts = [],
}: WhatsAppSettingsDialogProps) {
  const [accountId, setAccountId] = useState(defaultValues?.accountId ?? '');
  const [phoneNumber, setPhoneNumber] = useState(
    defaultValues?.phoneNumber ?? ''
  );

  const handleSave = () => {
    onSave?.({ accountId, phoneNumber });
  };

  return (
    <IntegrationSettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="WhatsApp"
      icon={<img src="/wa-icon.svg" alt="WhatsApp" className="size-10" />}
      onSave={handleSave}
      onDisconnect={onDisconnect}
    >
      <Field>
        <FieldLabel>WhatsApp Business Account</FieldLabel>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Phone Number</FieldLabel>
        <Input
          type="tel"
          placeholder="Enter your phone number"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
        />
      </Field>

      <p className="text-xs text-muted-foreground">
        Message templates are now managed in{' '}
        <Link
          to="/dashboard/settings/message-templates"
          className="underline underline-offset-2 hover:text-foreground"
        >
          Settings → Message templates
        </Link>
        .
      </p>
    </IntegrationSettingsDialog>
  );
}
