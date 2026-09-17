import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { MetaErrorDetail } from '@borradh-workspace/api-client';
import {
  AlertTriangle,
  Ban,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  Lock,
  type LucideIcon,
  Play,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { useState } from 'react';

// ---------------------------------------------------------------------------
// Video guide registry — maps slug to video URL
// Record videos and add URLs here. The dialog will show a "Watch guide" button.
// ---------------------------------------------------------------------------

const VIDEO_GUIDES: Record<string, string> = {
  // Add video URLs as you record them:
  // 'reconnect-meta': 'https://cdn.borradh.io/guides/reconnect-meta.mp4',
  // 'add-payment-method': 'https://cdn.borradh.io/guides/add-payment-method.mp4',
  // 'lead-gen-tos': 'https://cdn.borradh.io/guides/lead-gen-tos.mp4',
  // 'connect-whatsapp': 'https://cdn.borradh.io/guides/connect-whatsapp.mp4',
  // 'facebook-checkpoint': 'https://cdn.borradh.io/guides/facebook-checkpoint.mp4',
  // 'policy-violation': 'https://cdn.borradh.io/guides/policy-violation.mp4',
  // 'page-roles': 'https://cdn.borradh.io/guides/page-roles.mp4',
  // 'link-instagram-page': 'https://cdn.borradh.io/guides/link-instagram-page.mp4',
  // 'authorize-ig-ads': 'https://cdn.borradh.io/guides/authorize-ig-ads.mp4',
  // 'ig-account-restricted': 'https://cdn.borradh.io/guides/ig-account-restricted.mp4',
  // 'ads-access-revoked': 'https://cdn.borradh.io/guides/ads-access-revoked.mp4',
  // 'account-flagged': 'https://cdn.borradh.io/guides/account-flagged.mp4',
  // 'custom-audience-tos': 'https://cdn.borradh.io/guides/custom-audience-tos.mp4',
};

// ---------------------------------------------------------------------------
// Category → visual style mapping
// ---------------------------------------------------------------------------

interface CategoryStyle {
  icon: LucideIcon;
  iconBg: string;
  iconColor: string;
  bannerBg: string;
  bannerBorder: string;
  bannerText: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
  auth_required: {
    icon: Lock,
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    iconColor: 'text-red-600 dark:text-red-400',
    bannerBg: 'bg-red-50 dark:bg-red-950/30',
    bannerBorder: 'border-red-200 dark:border-red-800',
    bannerText: 'text-red-800 dark:text-red-200',
  },
  payment_required: {
    icon: CreditCard,
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    iconColor: 'text-red-600 dark:text-red-400',
    bannerBg: 'bg-red-50 dark:bg-red-950/30',
    bannerBorder: 'border-red-200 dark:border-red-800',
    bannerText: 'text-red-800 dark:text-red-200',
  },
  user_action_required: {
    icon: FileText,
    iconBg: 'bg-amber-100 dark:bg-amber-900/30',
    iconColor: 'text-amber-600 dark:text-amber-400',
    bannerBg: 'bg-amber-50 dark:bg-amber-950/30',
    bannerBorder: 'border-amber-200 dark:border-amber-800',
    bannerText: 'text-amber-800 dark:text-amber-200',
  },
  permission_denied: {
    icon: ShieldAlert,
    iconBg: 'bg-orange-100 dark:bg-orange-900/30',
    iconColor: 'text-orange-600 dark:text-orange-400',
    bannerBg: 'bg-orange-50 dark:bg-orange-950/30',
    bannerBorder: 'border-orange-200 dark:border-orange-800',
    bannerText: 'text-orange-800 dark:text-orange-200',
  },
  account_restricted: {
    icon: Ban,
    iconBg: 'bg-red-100 dark:bg-red-900/30',
    iconColor: 'text-red-600 dark:text-red-400',
    bannerBg: 'bg-red-50 dark:bg-red-950/30',
    bannerBorder: 'border-red-200 dark:border-red-800',
    bannerText: 'text-red-800 dark:text-red-200',
  },
  rate_limited: {
    icon: Clock,
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
    bannerBg: 'bg-blue-50 dark:bg-blue-950/30',
    bannerBorder: 'border-blue-200 dark:border-blue-800',
    bannerText: 'text-blue-800 dark:text-blue-200',
  },
  transient: {
    icon: RefreshCw,
    iconBg: 'bg-blue-100 dark:bg-blue-900/30',
    iconColor: 'text-blue-600 dark:text-blue-400',
    bannerBg: 'bg-blue-50 dark:bg-blue-950/30',
    bannerBorder: 'border-blue-200 dark:border-blue-800',
    bannerText: 'text-blue-800 dark:text-blue-200',
  },
};

const DEFAULT_STYLE: CategoryStyle = {
  icon: AlertTriangle,
  iconBg: 'bg-gray-100 dark:bg-gray-900/30',
  iconColor: 'text-gray-600 dark:text-gray-400',
  bannerBg: 'bg-gray-50 dark:bg-gray-950/30',
  bannerBorder: 'border-gray-200 dark:border-gray-800',
  bannerText: 'text-gray-800 dark:text-gray-200',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MetaErrorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Structured Meta error details from the API response */
  error: MetaErrorDetail | null;
  /** Called when user wants to retry the action */
  onRetry?: () => void;
}

export function MetaErrorDialog({
  open,
  onOpenChange,
  error,
  onRetry,
}: MetaErrorDialogProps) {
  const [showVideo, setShowVideo] = useState(false);

  if (!error) return null;

  const style = CATEGORY_STYLES[error.category] ?? DEFAULT_STYLE;
  const Icon = style.icon;
  const videoUrl = error.videoGuideSlug
    ? VIDEO_GUIDES[error.videoGuideSlug]
    : undefined;

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) setShowVideo(false);
    onOpenChange(isOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-full ${style.iconBg}`}
            >
              <Icon className={`h-5 w-5 ${style.iconColor}`} />
            </div>
            <DialogTitle>{error.userTitle}</DialogTitle>
          </div>
          <DialogDescription className="pt-2 text-left">
            {error.userMessage}
          </DialogDescription>
        </DialogHeader>

        {/* Video guide */}
        {videoUrl && !showVideo && (
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowVideo(true)}
          >
            <Play className="h-4 w-4" />
            Watch how to fix this
          </Button>
        )}

        {videoUrl && showVideo && (
          <div className="overflow-hidden rounded-md border">
            <video
              src={videoUrl}
              controls
              autoPlay
              className="w-full"
              playsInline
            >
              <track kind="captions" />
            </video>
          </div>
        )}

        {/* Instruction banner */}
        {error.actionUrl && (
          <div
            className={`rounded-md border p-3 text-sm ${style.bannerBg} ${style.bannerBorder} ${style.bannerText}`}
          >
            {error.actionLabel
              ? `Click the button below to ${error.actionLabel.toLowerCase()}. After completing the step, come back here and try again.`
              : 'Follow the link below to resolve this issue, then come back and try again.'}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Close
          </Button>
          {error.retryable && onRetry && (
            <Button
              variant="outline"
              onClick={() => {
                handleOpenChange(false);
                onRetry();
              }}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
          )}
          {error.actionUrl && (
            <Button asChild>
              <a
                href={error.actionUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {error.actionLabel || 'Fix This'}
                <ExternalLink className="ml-2 h-4 w-4" />
              </a>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
