import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Calendar, Loader2, Mail, Phone, X } from 'lucide-react';
import * as React from 'react';

export interface IntegrationCardProps {
  id: string;
  provider: string;
  title: string;
  subtitle?: string;
  isActive?: boolean;
  icon?: React.ReactNode;
  onDisconnect?: (id: string) => void;
  isDisconnecting?: boolean;
  className?: string;
}

/**
 * Card component for displaying a connected integration account.
 * Shows account info with option to disconnect.
 */
export function IntegrationCard({
  id,
  provider,
  title,
  subtitle,
  isActive = true,
  icon,
  onDisconnect,
  isDisconnecting = false,
  className,
}: IntegrationCardProps) {
  const handleDisconnect = () => {
    onDisconnect?.(id);
  };

  // Default icons based on provider type
  const defaultIcon = React.useMemo(() => {
    if (icon) return icon;
    if (provider.includes('calendar') || provider.includes('calendly'))
      return <Calendar className="size-4" />;
    if (provider.includes('whatsapp') || provider.includes('phone'))
      return <Phone className="size-4" />;
    if (
      provider.includes('email') ||
      provider.includes('gmail') ||
      provider.includes('outlook')
    )
      return <Mail className="size-4" />;
    return null;
  }, [icon, provider]);

  return (
    <Card
      className={cn(
        'transition-colors',
        isActive
          ? 'border-green-500/30 bg-green-50/50 dark:bg-green-950/10'
          : 'border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-950/10',
        className
      )}
    >
      <CardContent className="flex items-center gap-3 p-3">
        {/* Icon */}
        {defaultIcon && (
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-md',
              isActive
                ? 'bg-green-100 text-green-600 dark:bg-green-900/50'
                : 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/50'
            )}
          >
            {defaultIcon}
          </div>
        )}

        {/* Info */}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{title}</span>
          {subtitle && (
            <span className="truncate text-xs text-muted-foreground">
              {subtitle}
            </span>
          )}
        </div>

        {/* Status Badge */}
        <Badge
          variant={isActive ? 'secondary' : 'outline'}
          className={cn(
            'shrink-0',
            isActive
              ? 'border-green-500/50 bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
              : 'border-yellow-500/50 bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300'
          )}
        >
          {isActive ? 'Active' : 'Inactive'}
        </Badge>

        {/* Disconnect Button */}
        {onDisconnect && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
          >
            {isDisconnecting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <X className="size-4" />
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export interface IntegrationCardListProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Container for multiple IntegrationCard components
 */
export function IntegrationCardList({
  children,
  className,
}: IntegrationCardListProps) {
  return <div className={cn('flex flex-col gap-2', className)}>{children}</div>;
}
