import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Link2, Save } from 'lucide-react';
import type * as React from 'react';

export interface IntegrationSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onSave?: () => void;
  onDisconnect?: () => void;
  isSaving?: boolean;
  isDisconnecting?: boolean;
}

export function IntegrationSettingsDialog({
  open,
  onOpenChange,
  title,
  icon,
  children,
  onSave,
  onDisconnect,
  isSaving = false,
  isDisconnecting = false,
}: IntegrationSettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center">
            {icon}
          </div>
          <div className="flex flex-col gap-1">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              Make changes to your profile here.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">{children}</div>

        <DialogFooter className="gap-2 sm:gap-2">
          {onDisconnect && (
            <Button
              type="button"
              variant="outline"
              onClick={onDisconnect}
              disabled={isDisconnecting || isSaving}
              className="gap-2"
            >
              <Link2 className="size-4" />
              Disconnect
            </Button>
          )}
          {onSave && (
            <Button
              type="button"
              onClick={onSave}
              disabled={isSaving || isDisconnecting}
              className="gap-2"
            >
              <Save className="size-4" />
              Save
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
