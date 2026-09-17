import { Button } from '@/components/ui/button';
import { openIntegrationOAuthUrl } from '@/lib/open-integration-oauth';
import { cn } from '@/lib/utils';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import * as React from 'react';

type ButtonProps = React.ComponentProps<typeof Button>;

export type IntegrationProvider =
  | 'google_calendar'
  | 'outlook_calendar'
  | 'calendly'
  | 'whatsapp'
  | 'meta_ads'
  | 'gmail'
  | 'outlook';

export interface IntegrationLinkButtonProps
  extends Omit<ButtonProps, 'onClick'> {
  provider: IntegrationProvider;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  authUrl: string;
  isConnected?: boolean;
  isLoading?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  connectedLabel?: string;
}

/**
 * Reusable button component for initiating OAuth flows.
 * Handles loading states, connected states, and redirects to OAuth URLs.
 */
export function IntegrationLinkButton({
  provider,
  label,
  description,
  icon,
  authUrl,
  isConnected = false,
  isLoading = false,
  onConnect,
  onDisconnect,
  connectedLabel = 'Connected',
  className,
  variant = 'outline',
  ...props
}: IntegrationLinkButtonProps) {
  const [isPending, setIsPending] = React.useState(false);

  const handleClick = () => {
    if (isConnected && onDisconnect) {
      onDisconnect();
      return;
    }

    if (onConnect) {
      onConnect();
      return;
    }

    // Default behavior: start OAuth (Bearer auth on native Capacitor)
    setIsPending(true);
    void openIntegrationOAuthUrl(authUrl).finally(() => setIsPending(false));
  };

  const showLoading = isLoading || isPending;

  return (
    <Button
      type="button"
      variant={isConnected ? 'secondary' : variant}
      className={cn(
        'h-auto min-h-[60px] w-full justify-start gap-4 px-4 py-3',
        isConnected && 'border-green-500/50 bg-green-50 dark:bg-green-950/20',
        className
      )}
      disabled={showLoading}
      onClick={handleClick}
      {...props}
    >
      {/* Icon */}
      <div
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-lg',
          isConnected
            ? 'bg-green-100 text-green-600 dark:bg-green-900/50'
            : 'bg-muted'
        )}
      >
        {showLoading ? (
          <Loader2 className="size-5 animate-spin" />
        ) : isConnected ? (
          <Check className="size-5" />
        ) : (
          icon
        )}
      </div>

      {/* Label and Description */}
      <div className="flex flex-1 flex-col items-start text-left">
        <span className="font-medium">
          {isConnected ? connectedLabel : label}
        </span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>

      {/* External link indicator when not connected */}
      {!isConnected && !showLoading && (
        <ExternalLink className="size-4 shrink-0 text-muted-foreground" />
      )}
    </Button>
  );
}
