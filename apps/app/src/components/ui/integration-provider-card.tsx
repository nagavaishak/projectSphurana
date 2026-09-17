import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  Clock,
  Link,
  Settings2,
  Sparkles,
  SquarePen,
} from 'lucide-react';
import type * as React from 'react';

export type IntegrationStatus =
  | 'connected'
  | 'disconnected'
  | 'coming_soon'
  | 'pending_configuration'
  | 'needs_reconnect';
export type IntegrationCategory =
  | 'popular'
  | 'payments'
  | 'messaging'
  | 'calendar'
  | 'booking'
  | 'social';

export interface IntegrationProvider {
  id: string;
  name: string;
  description: string;
  iconFile: string;
  category: IntegrationCategory;
  status: IntegrationStatus;
  isRecommended?: boolean;
}

export interface IntegrationProviderCardProps {
  provider: IntegrationProvider;
  onConnect?: (providerId: string) => void;
  onEdit?: (providerId: string) => void;
  isLoading?: boolean;
  className?: string;
  /** When set, disables the connect action and shows this reason inline. */
  disabledReason?: string;
}

const categoryLabels: Record<IntegrationCategory, string> = {
  popular: 'Popular',
  payments: 'Payments',
  messaging: 'Messaging',
  calendar: 'Calendar',
  booking: 'Booking',
  social: 'Social',
};

export function IntegrationProviderCard({
  provider,
  onConnect,
  onEdit,
  isLoading = false,
  className,
  disabledReason,
}: IntegrationProviderCardProps) {
  const { id, name, description, iconFile, category, status, isRecommended } =
    provider;

  const handleAction = () => {
    if (disabledReason) return;
    if (status === 'connected') {
      onEdit?.(id);
    } else if (
      status === 'disconnected' ||
      status === 'pending_configuration' ||
      status === 'needs_reconnect'
    ) {
      onConnect?.(id);
    }
  };

  const isActionDisabled = isLoading || !!disabledReason;

  return (
    <Card
      className={cn(
        'relative flex flex-col items-center p-4 gap-4 transition-shadow hover:shadow-md',
        className
      )}
    >
      {/* Header badges */}
      <div className="absolute left-4 right-4 top-4 flex items-start justify-between">
        <Badge
          variant="outline"
          className="text-xs font-medium text-muted-foreground rounded-md"
        >
          {categoryLabels[category]}
        </Badge>
        {isRecommended && (
          <Badge className="gap-1 bg-primary text-xs font-normal text-primary-foreground">
            <Sparkles className="size-3" />
            Recommended
          </Badge>
        )}
      </div>

      <CardContent className="flex flex-col items-center gap-2 px-6 pt-8 text-center">
        <div className="flex size-12 bg-accent rounded-md h-10 w-10 items-center justify-center">
          <img src={`/${iconFile}`} alt={name} className="size-6" />
        </div>

        <h3 className="text-base font-medium">{name}</h3>

        {/* Description */}
        <p className="max-w-xs text-center text-sm text-muted-foreground font-normal">
          {description}
        </p>

        {/* Action */}
        <div className="mt-2 w-full">
          {status === 'coming_soon' ? (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
              <Clock className="size-4" />
              Coming Soon
            </div>
          ) : status === 'connected' ? (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleAction}
              disabled={isActionDisabled}
            >
              <SquarePen className="size-4" />
              Edit Connection
            </Button>
          ) : status === 'pending_configuration' ? (
            <Button
              variant="default"
              className="w-full gap-2"
              onClick={handleAction}
              disabled={isActionDisabled}
            >
              <Settings2 className="size-4" />
              Complete Setup
            </Button>
          ) : status === 'needs_reconnect' ? (
            <Button
              variant="destructive"
              className="w-full gap-2"
              onClick={handleAction}
              disabled={isActionDisabled}
            >
              <AlertTriangle className="size-4" />
              Reconnect
            </Button>
          ) : (
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={handleAction}
              disabled={isActionDisabled}
              data-testid={`integration-connect-${id}`}
            >
              <Link className="size-4" />
              Connect
            </Button>
          )}
          {disabledReason && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              {disabledReason}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export interface IntegrationProviderGridProps {
  children: React.ReactNode;
  className?: string;
}

export function IntegrationProviderGrid({
  children,
  className,
}: IntegrationProviderGridProps) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {children}
    </div>
  );
}
