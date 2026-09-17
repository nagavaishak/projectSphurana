/** Create / edit dialog for suppliers (name, description). */

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Supplier } from '@borradh-workspace/api-client/types';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import {
  createSupplierForm,
  useCreateSupplier,
  useUpdateSupplier,
} from '../api';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createSupplierForm.labels;
const D = createSupplierForm.defaults;

interface SupplierDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier?: Supplier | null;
  onSuccess?: () => void;
}

export function SupplierDialog({
  open,
  onOpenChange,
  supplier,
  onSuccess,
}: SupplierDialogProps) {
  const isEdit = !!supplier;
  const formId = useId();
  const [name, setName] = useState(D.name);
  const [description, setDescription] = useState(D.description);

  useEffect(() => {
    if (open) {
      setName(supplier?.name ?? D.name);
      setDescription(supplier?.description ?? D.description);
    }
  }, [open, supplier]);

  const { createSupplierAsync, isCreating } = useCreateSupplier();
  const { updateSupplierAsync, isUpdating } = useUpdateSupplier();
  const isSaving = isCreating || isUpdating;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    // Raw intent; buildCreateSupplierPayload trims + coalesces in the hook.
    const intent = { name, description };
    try {
      if (isEdit && supplier) {
        await updateSupplierAsync({ supplierId: supplier.id, ...intent });
      } else {
        await createSupplierAsync(intent);
      }
      onOpenChange(false);
      onSuccess?.();
    } catch {
      // Hook already surfaces an error toast.
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit supplier' : 'Add supplier'}</DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${formId}-name`}>{L.name}</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Salon Supplies Co."
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${formId}-description`}>
                {L.description}
              </FieldLabel>
              <Textarea
                id={`${formId}-description`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Optional notes about this supplier"
              />
            </Field>
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSaving}>
            {isSaving && <Loader2 className="size-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Create supplier'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
