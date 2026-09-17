import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useState } from 'react';
import { IntegrationSettingsDialog } from './integration-settings-dialog';

interface GmailSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave?: (data: { accountId: string; signature: string }) => void;
  onDisconnect?: () => void;
  defaultValues?: {
    accountId?: string;
    signature?: string;
  };
  accounts?: { id: string; email: string }[];
}

export function GmailSettingsDialog({
  open,
  onOpenChange,
  onSave,
  onDisconnect,
  defaultValues,
  accounts = [],
}: GmailSettingsDialogProps) {
  const [accountId, setAccountId] = useState(defaultValues?.accountId ?? '');
  const [signature, setSignature] = useState(defaultValues?.signature ?? '');

  const handleSave = () => {
    onSave?.({ accountId, signature });
  };

  return (
    <IntegrationSettingsDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Gmail"
      icon={<img src="/gmail-icon.svg" alt="Gmail" className="size-10" />}
      onSave={handleSave}
      onDisconnect={onDisconnect}
    >
      <Field>
        <FieldLabel>Connected Account</FieldLabel>
        <Select value={accountId} onValueChange={setAccountId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an account" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((account) => (
              <SelectItem key={account.id} value={account.id}>
                {account.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Field>
        <FieldLabel>Signature</FieldLabel>
        <Textarea
          placeholder="Enter your email signature..."
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
          rows={4}
        />
      </Field>
    </IntegrationSettingsDialog>
  );
}
