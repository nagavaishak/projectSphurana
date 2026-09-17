/** Create / edit dialog for product categories (name only). */

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
import type { ProductCategory } from '@borradh-workspace/api-client/types';
import { Loader2 } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { toast } from 'sonner';
import {
  createProductCategoryForm,
  useCreateProductCategory,
  useUpdateProductCategory,
} from '../api';

/** Labels come from the form declaration — the contract locates by the same strings. */
const L = createProductCategoryForm.labels;
const D = createProductCategoryForm.defaults;

interface ProductCategoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  category?: ProductCategory | null;
  onSuccess?: () => void;
}

export function ProductCategoryDialog({
  open,
  onOpenChange,
  category,
  onSuccess,
}: ProductCategoryDialogProps) {
  const isEdit = !!category;
  const formId = useId();
  const [name, setName] = useState(D.name);

  useEffect(() => {
    if (open) {
      setName(category?.name ?? D.name);
    }
  }, [open, category]);

  const { createProductCategoryAsync, isCreating } = useCreateProductCategory();
  const { updateProductCategoryAsync, isUpdating } = useUpdateProductCategory();
  const isSaving = isCreating || isUpdating;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    // Raw intent; buildCreateProductCategoryPayload trims in the hook.
    const intent = { name };
    try {
      if (isEdit && category) {
        await updateProductCategoryAsync({
          categoryId: category.id,
          ...intent,
        });
      } else {
        await createProductCategoryAsync(intent);
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
          <DialogTitle>{isEdit ? 'Edit category' : 'Add category'}</DialogTitle>
        </DialogHeader>
        <form id={formId} onSubmit={handleSubmit}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${formId}-name`}>{L.name}</FieldLabel>
              <Input
                id={`${formId}-name`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Shampoo"
                required
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
            {isEdit ? 'Save changes' : 'Create category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
