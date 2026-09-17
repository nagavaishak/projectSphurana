/** Create / edit dialog for product brands (name, description). */

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
import type { ProductBrand } from '@borradh-workspace/api-client/types';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import {
  createProductBrandForm,
  useCreateProductBrand,
  useUpdateProductBrand,
} from '../api';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createProductBrandForm.labels;
const D = createProductBrandForm.defaults;

interface ProductBrandDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  brand?: ProductBrand | null;
  onSuccess?: () => void;
}

export function ProductBrandDialog({
  open,
  onOpenChange,
  brand,
  onSuccess,
}: ProductBrandDialogProps) {
  const isEdit = !!brand;
  const formId = useId();
  const [name, setName] = useState(D.name);
  const [description, setDescription] = useState(D.description);

  useEffect(() => {
    if (open) {
      setName(brand?.name ?? D.name);
      setDescription(brand?.description ?? D.description);
    }
  }, [open, brand]);

  const { createProductBrandAsync, isCreating } = useCreateProductBrand();
  const { updateProductBrandAsync, isUpdating } = useUpdateProductBrand();
  const isSaving = isCreating || isUpdating;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    // Raw intent; buildCreateProductBrandPayload trims + coalesces in the hook.
    const intent = { name, description };
    try {
      if (isEdit && brand) {
        await updateProductBrandAsync({ brandId: brand.id, ...intent });
      } else {
        await createProductBrandAsync(intent);
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
          <DialogTitle>{isEdit ? 'Edit brand' : 'Add brand'}</DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${formId}-name`}>{L.name}</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Kerastase"
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
                placeholder="Optional notes about this brand"
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
            {isEdit ? 'Save changes' : 'Create brand'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
