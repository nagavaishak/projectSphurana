import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { BlockedTimeEditScope } from '../api';

interface DeleteBlockedTimeScopeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (scope: BlockedTimeEditScope) => void;
  isDeleting?: boolean;
}

/**
 * Scope prompt shown when deleting an occurrence of a recurring blocked
 * time: this occurrence / this and following / all occurrences.
 */
export function DeleteBlockedTimeScopeDialog({
  open,
  onOpenChange,
  onConfirm,
  isDeleting,
}: DeleteBlockedTimeScopeDialogProps) {
  const [scope, setScope] = useState<BlockedTimeEditScope>('this');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete recurring blocked time</DialogTitle>
          <DialogDescription>
            This blocked time repeats. Choose what to delete.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={scope}
          onValueChange={(v) => setScope(v as BlockedTimeEditScope)}
        >
          <div className="flex items-center gap-2">
            <RadioGroupItem value="this" id="bt-del-this" />
            <Label htmlFor="bt-del-this" className="cursor-pointer">
              This occurrence only
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="following" id="bt-del-following" />
            <Label htmlFor="bt-del-following" className="cursor-pointer">
              This and following occurrences
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <RadioGroupItem value="all" id="bt-del-all" />
            <Label htmlFor="bt-del-all" className="cursor-pointer">
              All occurrences
            </Label>
          </div>
        </RadioGroup>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isDeleting}
            onClick={() => onConfirm(scope)}
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
