'use client';

import * as React from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { useDeleteAccount } from '@/features/user';
import { cn } from '@/lib/utils';

export default function SecurityTab({ className }: { className?: string }) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState('');
  const { deleteAccount, isDeleting } = useDeleteAccount();

  const canConfirm = confirmText === 'DELETE';

  const handleDelete = () => {
    if (!canConfirm) return;
    deleteAccount(undefined);
  };

  const handleOpenChange = (open: boolean) => {
    setConfirmOpen(open);
    if (!open) setConfirmText('');
  };

  return (
    <div className={cn('flex flex-col px-6 py-4', className)}>
      <div className="space-y-0">
        <div className="py-4">
          <h3 className="text-sm font-medium text-destructive">Danger Zone</h3>
        </div>

        <Separator />

        <div className="flex items-center justify-between py-4">
          <div className="flex-1">
            <p className="text-sm font-medium">Delete Account</p>
            <p className="text-sm text-muted-foreground">
              Permanently delete your account, organizations you own, and all
              associated data. This action cannot be undone.
            </p>
          </div>
          <div className="ml-4 shrink-0">
            <Button
              variant="destructive"
              onClick={() => setConfirmOpen(true)}
              disabled={isDeleting}
            >
              Delete Account
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={handleOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your account, any organizations you
              are the sole owner of, and all associated data. This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <label
              htmlFor="confirm-delete"
              className="text-sm text-muted-foreground"
            >
              Type <span className="font-semibold text-foreground">DELETE</span>{' '}
              to confirm
            </label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="mt-2"
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={!canConfirm || isDeleting}
              className={cn(
                buttonDestructiveClass,
                (!canConfirm || isDeleting) && 'opacity-50'
              )}
            >
              {isDeleting ? 'Deleting...' : 'Delete Account'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const buttonDestructiveClass =
  'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive';
