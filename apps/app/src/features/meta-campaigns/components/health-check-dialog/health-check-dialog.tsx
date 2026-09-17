import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  HealthCheckItem,
  HealthCheckResult,
} from '@/features/meta-ads/api/health-check';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  XCircle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Video guide registry — maps slug to video URL
// (shared with MetaErrorDialog, but kept local for now)
// ---------------------------------------------------------------------------

const VIDEO_GUIDES: Record<string, string> = {
  // Add video URLs as you record them:
  // 'reconnect-meta': 'https://cdn.borradh.io/guides/reconnect-meta.mp4',
  // 'add-payment-method': 'https://cdn.borradh.io/guides/add-payment-method.mp4',
  // 'check-account-quality': 'https://cdn.borradh.io/guides/check-account-quality.mp4',
  // 'increase-spending-limit': 'https://cdn.borradh.io/guides/increase-spending-limit.mp4',
  // 'page-roles': 'https://cdn.borradh.io/guides/page-roles.mp4',
  // 'link-instagram-page': 'https://cdn.borradh.io/guides/link-instagram-page.mp4',
};

// ---------------------------------------------------------------------------
// Check labels
// ---------------------------------------------------------------------------

const CHECK_LABELS: Record<string, string> = {
  meta_connection: 'Meta connection',
  account_status: 'Ad account status',
  payment_method: 'Payment method',
  spending_limit: 'Spending limit',
  page_access: 'Facebook Page access',
  instagram_linked: 'Instagram connection',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface HealthCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: HealthCheckResult | null;
  isChecking: boolean;
  onRecheck: () => void;
  /** Called when all checks pass and user wants to proceed */
  onProceed: () => void;
}

function StatusIcon({ status }: { status: HealthCheckItem['status'] }) {
  if (status === 'pass')
    return (
      <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
    );
  if (status === 'warn')
    return (
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500 dark:text-amber-400" />
    );
  return (
    <XCircle className="h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
  );
}

function CheckRow({ item }: { item: HealthCheckItem }) {
  const videoUrl = item.videoGuideSlug
    ? VIDEO_GUIDES[item.videoGuideSlug]
    : undefined;
  const label = CHECK_LABELS[item.check] ?? item.check;

  return (
    <div className="flex gap-3 py-2">
      <StatusIcon status={item.status} />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              item.status === 'pass'
                ? 'text-foreground'
                : item.status === 'warn'
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-red-700 dark:text-red-300'
            }`}
          >
            {label}
          </span>
        </div>
        {item.status !== 'pass' && item.detail && (
          <p className="text-sm text-muted-foreground">{item.detail}</p>
        )}
        {item.status !== 'pass' && (item.actionUrl || videoUrl) && (
          <div className="flex gap-2 pt-1">
            {item.actionUrl && (
              <Button variant="outline" size="sm" asChild>
                <a
                  href={item.actionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.actionLabel || 'Fix This'}
                  <ExternalLink className="ml-1.5 h-3 w-3" />
                </a>
              </Button>
            )}
            {videoUrl && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(videoUrl, '_blank')}
              >
                <Play className="mr-1.5 h-3 w-3" />
                Watch Guide
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function HealthCheckDialog({
  open,
  onOpenChange,
  result,
  isChecking,
  onRecheck,
  onProceed,
}: HealthCheckDialogProps) {
  const allPassed = result?.overall === 'pass';
  const hasFailures = result?.overall === 'fail';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isChecking
              ? 'Checking your Meta account...'
              : hasFailures
                ? 'Your Meta account needs attention'
                : allPassed
                  ? 'All checks passed'
                  : 'Review before publishing'}
          </DialogTitle>
          {!isChecking && hasFailures && (
            <DialogDescription>
              Fix the issues below, then re-check before publishing your ad.
            </DialogDescription>
          )}
        </DialogHeader>

        {isChecking && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isChecking && result && (
          <div className="divide-y">
            {result.checks.map((item) => (
              <CheckRow key={item.check} item={item} />
            ))}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {!isChecking && hasFailures && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Close
              </Button>
              <Button variant="outline" onClick={onRecheck}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Re-check
              </Button>
            </>
          )}
          {!isChecking && !hasFailures && result && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={onProceed}>Continue to Publish</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
