import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Form } from '@/components/ui/form';
import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useCreateLeadForm } from '../customer-form/use-create-lead-form';
import { CreateLeadFormFields } from './create-lead-form-fields';

interface CreateLeadDialogProps {
  trigger?: ReactNode;
}

/**
 * The in-context quick-add client dialog.
 *
 * The Clients page's "Add Customer" is NOT this any more — it is the unified
 * `/create/customer` editor, like every other primary create action. This
 * dialog stays for the surfaces that fire it mid-task (the till, the calendar),
 * where navigating to a page would lose a half-finished sale or booking.
 *
 * It shares {@link useCreateLeadForm} and the field components in
 * {@link CreateLeadFormFields} with that editor, so the two cannot drift: same
 * schema, same defaults, same `buildCreateLeadPayload` body.
 */
export function CreateLeadDialog({ trigger }: CreateLeadDialogProps) {
  const [open, setOpen] = useState(false);
  const { form, isCreating, submit } = useCreateLeadForm({
    onDone: () => setOpen(false),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button>
            <Plus className="size-4" />
            Create Lead
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New Client</DialogTitle>
          <DialogDescription>
            Add a new client to your pipeline. Fill in the contact information
            below.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={(event) => void submit(event)} className="space-y-4">
            <CreateLeadFormFields form={form} />

            <div className="flex justify-end gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreating}>
                {isCreating ? 'Creating...' : 'Create Lead'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
