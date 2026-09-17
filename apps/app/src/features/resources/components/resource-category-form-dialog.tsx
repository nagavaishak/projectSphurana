import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useId, useMemo, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  type ResourceCategory,
  type ResourceCategoryKind,
  resourceCategoryKindLabels,
  resourceCategoryKindValues,
  useCreateResourceCategory,
  useUpdateResourceCategory,
} from '../api';

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  kind: z.enum(resourceCategoryKindValues),
});

type CategoryFormData = z.infer<typeof categoryFormSchema>;

interface ResourceCategoryFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this category instead of creating one. */
  category?: ResourceCategory | null;
}

/**
 * Create/edit a resource category ("Rooms", "Lasers").
 *
 * `kind` is copy and defaults only — the scheduling engine treats every
 * category identically. It exists so the settings page can say "Add room"
 * rather than "Add resource".
 */
export function ResourceCategoryFormDialog({
  open,
  onOpenChange,
  category,
}: ResourceCategoryFormDialogProps) {
  const isEditing = !!category;
  const formId = useId();

  const defaultValues = useMemo<CategoryFormData>(
    () => ({
      name: category?.name ?? '',
      kind: (category?.kind ?? 'room') as ResourceCategoryKind,
    }),
    [category]
  );

  const form = useForm<CategoryFormData>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues,
  });

  // Re-seed on the OPEN TRANSITION only.
  //
  // `defaultValues` is a `useMemo` over props, so leaving it to drive this
  // effect meant any parent re-render reset the form WHILE IT WAS OPEN and
  // discarded whatever had been typed. Observed by hand in this dialog: a name
  // entered then lost, and a Location picked then reverted to "All locations".
  // `hasSeeded` makes it fire on false→true only.
  const hasSeeded = useRef(false);
  useEffect(() => {
    if (open && !hasSeeded.current) {
      form.reset(defaultValues);
      hasSeeded.current = true;
    } else if (!open) {
      hasSeeded.current = false;
    }
  }, [open, defaultValues, form]);

  const { createCategory, isCreating } = useCreateResourceCategory({
    onSuccess: () => onOpenChange(false),
  });
  const { updateCategory, isUpdating } = useUpdateResourceCategory({
    onSuccess: () => onOpenChange(false),
  });

  const handleSubmit = (data: CategoryFormData) => {
    const payload = { name: data.name.trim(), kind: data.kind };
    if (isEditing && category) {
      updateCategory({ id: category.id, ...payload });
    } else {
      createCategory(payload);
    }
  };

  const isSaving = isCreating || isUpdating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit category' : 'New category'}
          </DialogTitle>
          <DialogDescription>
            Group the things a booking can hold — rooms, lasers, chairs.
          </DialogDescription>
        </DialogHeader>

        <form
          id={formId}
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-4"
        >
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  placeholder="e.g. Treatment rooms"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          <Controller
            name="kind"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Kind</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {resourceCategoryKindValues.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {resourceCategoryKindLabels[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Rooms hold one appointment at a time. Equipment can move
                  between rooms.
                </FieldDescription>
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEditing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
