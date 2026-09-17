import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { InstagramIntegration } from '@/features/integrations/types';
import { Instagram, Link2, RefreshCw } from 'lucide-react';

interface InstagramSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDisconnect?: () => void;
  onReconnect?: () => void;
  integration: InstagramIntegration | null;
}

export function InstagramSettingsDialog({
  open,
  onOpenChange,
  onDisconnect,
  onReconnect,
  integration,
}: InstagramSettingsDialogProps) {
  if (!integration) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400">
            <Instagram className="size-5 text-white" />
          </div>
          <div className="flex flex-col gap-1">
            <DialogTitle>Instagram</DialogTitle>
            <DialogDescription>Connected Instagram account</DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          {/* Profile */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Avatar className="size-10">
              {integration.profilePictureUrl && (
                <AvatarImage
                  src={integration.profilePictureUrl}
                  alt={integration.name ?? 'Instagram'}
                />
              )}
              <AvatarFallback>
                <Instagram className="size-4" />
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              {integration.name && (
                <p className="truncate text-sm font-medium">
                  {integration.name}
                </p>
              )}
              {integration.username && (
                <p className="truncate text-xs text-muted-foreground">
                  @{integration.username}
                </p>
              )}
            </div>
            {integration.accountType && (
              <Badge variant="secondary" className="shrink-0 text-xs">
                {integration.accountType === 'BUSINESS'
                  ? 'Business'
                  : integration.accountType === 'MEDIA_CREATOR'
                    ? 'Creator'
                    : 'Personal'}
              </Badge>
            )}
          </div>

          {/* Connection info */}
          <div className="space-y-2 text-sm">
            {integration.connectedByName && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connected by</span>
                <span>{integration.connectedByName}</span>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {onDisconnect && (
            <Button
              type="button"
              variant="outline"
              onClick={onDisconnect}
              className="gap-2"
            >
              <Link2 className="size-4" />
              Disconnect
            </Button>
          )}
          {onReconnect && (
            <Button type="button" onClick={onReconnect} className="gap-2">
              <RefreshCw className="size-4" />
              Reconnect
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
