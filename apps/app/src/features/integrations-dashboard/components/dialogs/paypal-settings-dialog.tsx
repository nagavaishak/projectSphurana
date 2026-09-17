import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useState } from 'react';
import { IntegrationSettingsDialog } from './integration-settings-dialog';

interface PayPalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (data: { accountId: string; email: string }) => void;
  onDisconnect?: () => void;
  defaultValues?: {
    accountId?: string;
    email?: string;
  };
  accounts?: { id: string; name: string }[];
  emails?: { id: string; email: string }[];
}

export function PayPalSettingsDialog({
  open,
  onOpenChange,
  onSave,
  onDisconnect,
  defaultValues,
  accounts = [],
  emails = [],
}: PayPalSettingsDialogProps) {
  const [accountId, setAccountId] = useState(defaultValues?.accountId ?? '');
  const [email, setEmail] = useState(defaultValues?.email ?? '');

  const handleSave = () => {
    onSave?.({ accountId, email });
  };

  return (
    <IntegrationSettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paypal"
      icon={<img src="/paypal-icon.svg" alt="PayPal" className="size-10" />}
      onSave={handleSave}
      onDisconnect={onDisconnect}
    >
      <Field>
        <FieldLabel>Connected Account ID</FieldLabel>
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
        <FieldLabel>Connected Account Email</FieldLabel>
        <Select value={email} onValueChange={setEmail}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Enter an email" />
          </SelectTrigger>
          <SelectContent>
            {emails.map((e) => (
              <SelectItem key={e.id} value={e.email}>
                {e.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
    </IntegrationSettingsDialog>
  );
}
