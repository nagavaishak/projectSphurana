import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  FileText,
  Loader2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfigureMetaIntegration, useConnectMetaIntegration } from '../api';
import type {
  MetaAdAccountInfo,
  MetaAdsWizardSession,
  MetaPageInfo,
  MetaPageInfoStored,
} from '../types';

// Meta/Facebook icon
const MetaIcon = () => (
  <svg className="size-6" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <title>Meta</title>
    <rect x="2" y="2" width="20" height="20" rx="4" fill="#1877F2" />
    <path
      d="M16.5 12.5C16.5 9.46 14.04 7 11 7C7.96 7 5.5 9.46 5.5 12.5C5.5 15.26 7.52 17.54 10.16 17.94V14.31H8.57V12.5H10.16V11.12C10.16 9.55 11.09 8.69 12.53 8.69C13.21 8.69 13.93 8.81 13.93 8.81V10.35H13.14C12.37 10.35 12.13 10.83 12.13 11.32V12.5H13.86L13.58 14.31H12.13V17.94C14.77 17.54 16.79 15.26 16.79 12.5H16.5Z"
      fill="white"
    />
  </svg>
);

/**
 * Props for the Meta Ads wizard modal
 * Supports two modes:
 * 1. Legacy mode: sessionData from URL (deprecated, for backwards compatibility)
 * 2. New mode: integrationId + availableAdAccounts + availablePages from DB
 */
interface MetaAdsWizardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** @deprecated Use integrationId instead - session data from URL */
  sessionData?: MetaAdsWizardSession | null;
  /** Integration ID for the new flow (data fetched from DB) */
  integrationId?: string | null;
  /** Available ad accounts (from integration's stored options) */
  availableAdAccounts?: MetaAdAccountInfo[];
  /** Available pages (from integration's stored options) */
  availablePages?: MetaPageInfoStored[];
  onSuccess?: () => void;
  onCancel?: () => void;
}

type WizardStep = 'ad-account' | 'page' | 'confirming';

export function MetaAdsWizardModal({
  open,
  onOpenChange,
  sessionData,
  integrationId,
  availableAdAccounts: propsAdAccounts,
  availablePages: propsPages,
  onSuccess,
  onCancel,
}: MetaAdsWizardModalProps) {
  const [step, setStep] = useState<WizardStep>('ad-account');
  const [selectedAdAccountIds, setSelectedAdAccountIds] = useState<string[]>(
    []
  );
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);

  // Determine which flow to use
  const useNewFlow = !!integrationId;

  // Legacy flow: use connectMetaIntegration (requires code/accessToken)
  const { connectMeta, isConnecting: isConnectingLegacy } =
    useConnectMetaIntegration({
      onSuccess: () => {
        onSuccess?.();
        handleClose();
      },
      onError: () => {
        setStep('page'); // Go back to selection on error
      },
    });

  // New flow: use configureMetaIntegration (uses integrationId)
  const { configureMeta, isConfiguring } = useConfigureMetaIntegration({
    onSuccess: () => {
      onSuccess?.();
      handleClose();
    },
    onError: () => {
      setStep('page'); // Go back to selection on error
    },
  });

  const isConnecting = useNewFlow ? isConfiguring : isConnectingLegacy;

  // Get ad accounts and pages from either source
  const adAccounts: MetaAdAccountInfo[] = useNewFlow
    ? (propsAdAccounts ?? [])
    : (sessionData?.adAccounts ?? []);

  // Convert stored pages to MetaPageInfo format for display
  const pages: MetaPageInfo[] = useNewFlow
    ? (propsPages ?? []).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        pictureUrl: p.pictureUrl,
      }))
    : (sessionData?.pages ?? []);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep('ad-account');
      setSelectedAdAccountIds([]);
      setSelectedPageIds([]);
    }
  }, [open]);

  const handleClose = () => {
    if (!isConnecting) {
      onOpenChange(false);
      onCancel?.();
    }
  };

  const handleNext = () => {
    if (step === 'ad-account' && selectedAdAccountIds.length > 0) {
      setStep('page');
    } else if (step === 'page' && selectedPageIds.length > 0) {
      handleConnect();
    }
  };

  const handleBack = () => {
    if (step === 'page') {
      setStep('ad-account');
    }
  };

  const handleConnect = () => {
    if (selectedAdAccountIds.length === 0 || selectedPageIds.length === 0)
      return;

    setStep('confirming');

    if (useNewFlow && integrationId) {
      // New flow: configure existing integration with arrays
      configureMeta({
        integrationId,
        adAccountIds: selectedAdAccountIds,
        pageIds: selectedPageIds,
      });
    } else if (sessionData) {
      // Legacy flow: connect with code/accessToken (single-select only)
      const firstAdAccount = adAccounts.find(
        (a) => a.accountId === selectedAdAccountIds[0]
      );
      const firstPage = pages.find((p) => p.id === selectedPageIds[0]);
      if (firstAdAccount && firstPage) {
        connectMeta({
          code: sessionData.accessToken,
          adAccountId: firstAdAccount.accountId,
          adAccountName: firstAdAccount.name,
          pageId: firstPage.id,
          pageName: firstPage.name,
        });
      }
    }
  };

  // Don't render if no data available
  const hasData =
    (useNewFlow && propsAdAccounts && propsPages) ||
    (!useNewFlow && sessionData);
  if (!hasData) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg" showCloseButton={!isConnecting}>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <MetaIcon />
            <div>
              <DialogTitle>Connect Meta Ads</DialogTitle>
              <DialogDescription>
                {step === 'ad-account' &&
                  'Select the ad accounts you want to use for campaigns.'}
                {step === 'page' &&
                  'Select the Facebook pages for your ad campaigns.'}
                {step === 'confirming' && 'Connecting your Meta Ads account...'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 py-2">
          <div
            className={`flex size-8 items-center justify-center rounded-full text-sm font-medium ${
              step === 'ad-account'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {selectedAdAccountIds.length > 0 ? (
              <CheckCircle2 className="size-4" />
            ) : (
              '1'
            )}
          </div>
          <div className="h-0.5 w-8 bg-muted" />
          <div
            className={`flex size-8 items-center justify-center rounded-full text-sm font-medium ${
              step === 'page' || step === 'confirming'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {selectedPageIds.length > 0 ? (
              <CheckCircle2 className="size-4" />
            ) : (
              '2'
            )}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-[280px]">
          {step === 'ad-account' && (
            <AdAccountSelection
              adAccounts={adAccounts}
              selectedIds={selectedAdAccountIds}
              onToggle={(id) => {
                setSelectedAdAccountIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                );
              }}
            />
          )}

          {step === 'page' && (
            <PageSelection
              pages={pages}
              selectedIds={selectedPageIds}
              onToggle={(id) => {
                setSelectedPageIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                );
              }}
            />
          )}

          {step === 'confirming' && (
            <div className="flex h-full flex-col items-center justify-center gap-4 py-8">
              <Loader2 className="size-10 animate-spin text-primary" />
              <div className="text-center">
                <p className="font-medium">Connecting Meta Ads</p>
                <p className="text-sm text-muted-foreground">
                  Setting up {selectedAdAccountIds.length} ad account
                  {selectedAdAccountIds.length !== 1 ? 's' : ''} with{' '}
                  {selectedPageIds.length} page
                  {selectedPageIds.length !== 1 ? 's' : ''}...
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {step === 'ad-account' && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleNext}
                disabled={selectedAdAccountIds.length === 0}
              >
                Next
              </Button>
            </>
          )}

          {step === 'page' && (
            <>
              <Button variant="outline" onClick={handleBack}>
                Back
              </Button>
              <Button
                onClick={handleNext}
                disabled={selectedPageIds.length === 0}
              >
                Connect
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Get human-readable status info for a Meta ad account
 */
function getAccountStatusInfo(account: MetaAdAccountInfo): {
  label: string;
  variant: 'default' | 'secondary' | 'destructive' | 'outline';
  isUsable: boolean;
  warning?: string;
} {
  switch (account.accountStatus) {
    case 1:
      if (account.hasPaymentMethod === false) {
        return {
          label: 'No Payment',
          variant: 'destructive',
          isUsable: false,
          warning:
            'This ad account has no payment method. Add one in Meta Business Settings before running ads.',
        };
      }
      return { label: 'Active', variant: 'default', isUsable: true };
    case 2:
      return {
        label: 'Disabled',
        variant: 'destructive',
        isUsable: false,
        warning:
          'This ad account has been disabled by Meta. Check Meta Business Settings for details.',
      };
    case 3:
      return {
        label: 'Unsettled',
        variant: 'destructive',
        isUsable: false,
        warning:
          'This ad account has an unpaid balance. Pay the outstanding balance in Meta Business Settings.',
      };
    case 7:
      return {
        label: 'Under Review',
        variant: 'secondary',
        isUsable: false,
        warning:
          'This ad account is under review by Meta. Wait for the review to complete.',
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
        warning: 'This ad account has been closed and cannot be used.',
      };
    default:
      return { label: 'Unknown', variant: 'secondary', isUsable: true };
  }
}

// Ad Account Selection Component (multi-select)
function AdAccountSelection({
  adAccounts,
  selectedIds,
  onToggle,
}: {
  adAccounts: MetaAdAccountInfo[];
  selectedIds: string[];
  onToggle: (accountId: string) => void;
}) {
  if (adAccounts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <Building2 className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No ad accounts found. Please make sure you have access to at least one
          Meta ad account.
        </p>
      </div>
    );
  }

  // Sort: usable accounts first
  const sorted = [...adAccounts].sort((a, b) => {
    const aInfo = getAccountStatusInfo(a);
    const bInfo = getAccountStatusInfo(b);
    if (aInfo.isUsable && !bInfo.isUsable) return -1;
    if (!aInfo.isUsable && bInfo.isUsable) return 1;
    return 0;
  });

  return (
    <ScrollArea className="h-[280px] pr-4">
      <div className="space-y-2">
        {selectedIds.length > 0 && (
          <p className="text-xs text-muted-foreground mb-2">
            {selectedIds.length} selected
          </p>
        )}
        {sorted.map((account) => {
          const statusInfo = getAccountStatusInfo(account);
          const isSelected = selectedIds.includes(account.accountId);
          return (
            <button
              key={account.id}
              type="button"
              disabled={!statusInfo.isUsable}
              onClick={() => {
                if (statusInfo.isUsable) onToggle(account.accountId);
              }}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                !statusInfo.isUsable
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:bg-muted/50 cursor-pointer'
              } ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="mt-1"
              >
                <Checkbox
                  checked={isSelected}
                  disabled={!statusInfo.isUsable}
                  tabIndex={-1}
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
                <span className="text-xs text-muted-foreground">
                  ID: {account.accountId}
                </span>
                {account.businessName && (
                  <span className="text-xs text-muted-foreground">
                    Business: {account.businessName}
                  </span>
                )}
                {statusInfo.warning && (
                  <div className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                    <span>{statusInfo.warning}</span>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// Page Selection Component (multi-select)
function PageSelection({
  pages,
  selectedIds,
  onToggle,
}: {
  pages: MetaPageInfo[];
  selectedIds: string[];
  onToggle: (pageId: string) => void;
}) {
  if (pages.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <FileText className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">
          No Facebook pages found. Please make sure you have admin access to at
          least one Facebook page.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[280px] pr-4">
      <div className="space-y-2">
        {selectedIds.length > 0 && (
          <p className="text-xs text-muted-foreground mb-2">
            {selectedIds.length} selected
          </p>
        )}
        {pages.map((page) => {
          const isSelected = selectedIds.includes(page.id);
          return (
            <button
              key={page.id}
              type="button"
              onClick={() => onToggle(page.id)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-muted/50 cursor-pointer ${
                isSelected ? 'border-primary bg-primary/5' : 'border-border'
              }`}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="mt-1"
              >
                <Checkbox checked={isSelected} tabIndex={-1} />
              </div>
              <div className="flex flex-1 items-center gap-3">
                <Avatar className="size-10">
                  {page.pictureUrl && <AvatarImage src={page.pictureUrl} />}
                  <AvatarFallback>{page.name[0]}</AvatarFallback>
                </Avatar>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">{page.name}</span>
                  {page.category && (
                    <span className="text-xs text-muted-foreground">
                      {page.category}
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// Utility function to parse session data from URL
export function parseMetaAdsWizardSession(
  sessionParam: string | null
): MetaAdsWizardSession | null {
  if (!sessionParam) return null;

  try {
    const decoded = atob(sessionParam);
    return JSON.parse(decoded) as MetaAdsWizardSession;
  } catch {
    console.error('Failed to parse Meta Ads wizard session');
    return null;
  }
}
