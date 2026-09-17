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

interface StripeSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (data: { accountId: string }) => void;
  onDisconnect?: () => void;
  defaultValues?: {
    accountId?: string;
  };
  accounts?: { id: string; name: string }[];
}

export function StripeSettingsDialog({
  open,
  onOpenChange,
  onSave,
  onDisconnect,
  defaultValues,
  accounts = [],
}: StripeSettingsDialogProps) {
  const [accountId, setAccountId] = useState(defaultValues?.accountId ?? '');

  const handleSave = () => {
    onSave?.({ accountId });
  };

  return (
    <IntegrationSettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Stripe"
      icon={<img src="/stripe-icon.svg" alt="Stripe" className="size-10" />}
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
    </IntegrationSettingsDialog>
  );
}
