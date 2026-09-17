import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

import type { MetaAdAccountInfo } from '@/features/integrations/types';
import {
  AlertTriangle,
  Building2,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { type UseFormReturn, useWatch } from 'react-hook-form';
import type { MetaAdsSetupFormData } from './meta-ads-setup-form';

const META_BUSINESS_SETTINGS_URL = 'https://business.facebook.com/settings';

interface Step1SelectAdAccountProps {
  form: UseFormReturn<MetaAdsSetupFormData>;
  adAccounts: MetaAdAccountInfo[];
  onReconnect: () => void;
  onRefresh: () => void;
}

function getAccountStatusInfo(account: MetaAdAccountInfo): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  isUsable: boolean;
  warning?: string;
  fixInstruction?: string;
} {
  switch (account.accountStatus) {
    case 1:
      if (account.hasPaymentMethod === false) {
        return {
          label: 'No Payment',
          variant: 'destructive',
          isUsable: false,
          warning: 'This ad account has no payment method.',
          fixInstruction: 'Add a payment method in Meta Business Settings.',
        };
      }
      return { label: 'Active', variant: 'default', isUsable: true };
    case 2:
      return {
        label: 'Disabled',
        variant: 'destructive',
        isUsable: false,
        warning: 'This ad account has been disabled by Meta.',
        fixInstruction: 'Go to Meta Business Settings to resolve this issue.',
      };
    case 3:
      return {
        label: 'Unsettled',
        variant: 'destructive',
        isUsable: false,
        warning: 'This ad account has an unpaid balance.',
        fixInstruction:
          'Pay your outstanding balance in Meta Business Settings.',
      };
    case 7:
      return {
        label: 'Under Review',
        variant: 'secondary',
        isUsable: false,
        warning: 'This ad account is under review by Meta.',
        fixInstruction: 'Wait for Meta to complete their review.',
      };
    case 9:
      return {
        label: 'Grace Period',
        variant: 'secondary',
        isUsable: true,
        warning:
          'This ad account is in a grace period. Update your payment method to avoid disruption.',
      };
    case 100:
    case 101:
      return {
        label: 'Closed',
        variant: 'destructive',
        isUsable: false,
        warning: 'This account has been permanently closed.',
        fixInstruction:
          'This account has been permanently closed and cannot be used.',
      };
    default:
      return { label: 'Unknown', variant: 'secondary', isUsable: true };
  }
}

export function Step1SelectAdAccount({
  form,
  adAccounts,
  onReconnect,
  onRefresh,
}: Step1SelectAdAccountProps) {
  const selectedIds: string[] =
    useWatch({ control: form.control, name: 'adAccountIds' }) ?? [];
  const hasUsableAccounts = adAccounts.some(
    (a) => getAccountStatusInfo(a).isUsable
  );

  // Sort: usable accounts first
  const sorted = [...adAccounts].sort((a, b) => {
    const aInfo = getAccountStatusInfo(a);
    const bInfo = getAccountStatusInfo(b);
    if (aInfo.isUsable && !bInfo.isUsable) return -1;
    if (!aInfo.isUsable && bInfo.isUsable) return 1;
    return 0;
  });

  const toggleAccount = (accountId: string) => {
    const current = form.getValues('adAccountIds') ?? [];
    const next = current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId];
    form.setValue('adAccountIds', next);
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Select your Ad Accounts</h1>
        <p className="text-sm text-muted-foreground">
          Choose one or more ad accounts to use for campaigns.
        </p>
      </div>

      {adAccounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <Building2 className="size-12 text-muted-foreground/50" />
          <div>
            <p className="font-medium">No ad accounts found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Make sure you have access to at least one Meta ad account.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onRefresh}>
              <RefreshCw className="size-4" />
              Refresh Accounts
            </Button>
            <Button size="sm" onClick={onReconnect}>
              Reconnect Meta Account
            </Button>
          </div>
        </div>
      ) : (
        <>
          {!hasUsableAccounts && (
            <Alert variant="destructive">
              <AlertTriangle className="size-4" />
              <AlertTitle>No usable ad accounts</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>
                  All your ad accounts have issues that need to be resolved
                  before you can continue.
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={META_BUSINESS_SETTINGS_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Open Meta Business Settings
                      <ExternalLink className="size-3" />
                    </a>
                  </Button>
                  <Button size="sm" onClick={onReconnect}>
                    Reconnect Meta Account
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {selectedIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedIds.length} account{selectedIds.length !== 1 ? 's' : ''}{' '}
              selected
            </p>
          )}

          <div className="max-h-[360px] overflow-y-auto pr-4">
            <div className="space-y-2">
              {sorted.map((account) => {
                const statusInfo = getAccountStatusInfo(account);
                const isSelected = selectedIds.includes(account.accountId);
                return (
                  <div
                    key={account.id}
                    role="button"
                    tabIndex={statusInfo.isUsable ? 0 : undefined}
                    aria-disabled={!statusInfo.isUsable}
                    onClick={() => {
                      if (statusInfo.isUsable) {
                        toggleAccount(account.accountId);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (
                        statusInfo.isUsable &&
                        (e.key === ' ' || e.key === 'Enter')
                      ) {
                        e.preventDefault();
                        toggleAccount(account.accountId);
                      }
                    }}
                    className={`flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors ${
                      !statusInfo.isUsable
                        ? 'cursor-not-allowed opacity-60'
                        : 'hover:bg-muted/50 cursor-pointer'
                    } ${
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border'
                    }`}
                  >
                    {/* Wrapper stops Radix CheckboxBubbleInput's synthetic click from bubbling to parent */}
                    <div
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      className="mt-1"
                    >
                      <Checkbox
                        checked={isSelected}
                        disabled={!statusInfo.isUsable}
                        tabIndex={-1}
                        aria-hidden
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{account.name}</span>
                        <Badge variant="secondary" className="text-xs">
                          {account.currency}
                        </Badge>
                        <Badge variant={statusInfo.variant} className="text-xs">
                          {statusInfo.label}
                        </Badge>
                      </div>
                      {statusInfo.isUsable ? (
                        <span className="text-xs text-muted-foreground">
                          ID: {account.accountId}
                        </span>
                      ) : statusInfo.warning ? (
                        <span className="text-xs text-muted-foreground">
                          {statusInfo.warning}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          ID: {account.accountId}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <Button
            variant="ghost"
            size="sm"
            type="button"
            className="self-start"
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
            Refresh Accounts
          </Button>
        </>
      )}
    </div>
  );
}
