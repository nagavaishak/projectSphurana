'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  useGetServiceIntakeForms,
  useListIntakeForms,
  useSetServiceIntakeForms,
} from '@/features/intake-forms/api';
import { useListServices } from '@/features/organization-services/api';
import { useEffect, useState } from 'react';

interface ServiceIntakeFormsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface Selection {
  checked: boolean;
  blocksBooking: boolean;
}

/**
 * Attach intake forms to a service. Saving REPLACES the service's whole set
 * (the backend does a replace-the-set write), so the checklist here is the
 * complete desired state. `blocksBooking` is the "required — holds up
 * confirmation until completed" toggle per form.
 */
export function ServiceIntakeFormsDialog({
  open,
  onOpenChange,
}: ServiceIntakeFormsDialogProps) {
  const { services, isError: isServicesError } = useListServices();
  const { forms, isError: isFormsError } = useListIntakeForms();
  const [serviceId, setServiceId] = useState<string>('');
  const [selection, setSelection] = useState<Record<string, Selection>>({});

  // The service's CURRENT links — so the checklist opens pre-populated (the save
  // is replace-the-set, so it must start from the existing state, not blank).
  const { links } = useGetServiceIntakeForms(serviceId);

  useEffect(() => {
    if (!open) {
      setServiceId('');
      setSelection({});
    }
  }, [open]);

  // Seed the selection from the server whenever a service's links arrive. Keyed
  // on serviceId so switching services re-seeds; the fetch is per-service.
  useEffect(() => {
    if (!serviceId) return;
    setSelection(
      Object.fromEntries(
        links.map((l) => [
          l.intakeFormId,
          { checked: true, blocksBooking: l.blocksBooking },
        ])
      )
    );
  }, [serviceId, links]);

  const { setServiceForms, isSaving } = useSetServiceIntakeForms({
    onSuccess: () => onOpenChange(false),
  });

  const patch = (formId: string, patchValue: Partial<Selection>) =>
    setSelection((prev) => ({
      ...prev,
      [formId]: {
        ...{ checked: false, blocksBooking: false },
        ...prev[formId],
        ...patchValue,
      },
    }));

  const handleSave = () => {
    const linked = forms
      .filter((f) => selection[f.id]?.checked)
      .map((f) => ({
        intakeFormId: f.id,
        blocksBooking: selection[f.id]?.blocksBooking ?? false,
      }));
    setServiceForms({ serviceId, forms: linked });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Attach forms to a service</DialogTitle>
          <DialogDescription>
            Choose which forms are sent when a client books this service.
            Marking a form as required holds up the booking until it&apos;s
            completed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="service-select">Service</FieldLabel>
            <Select value={serviceId} onValueChange={setServiceId}>
              <SelectTrigger id="service-select">
                <SelectValue placeholder="Select a service" />
              </SelectTrigger>
              <SelectContent>
                {services.map((service) => (
                  <SelectItem key={service.id} value={service.id}>
                    {service.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Otherwise a failed load is an empty dropdown with no
                explanation — indistinguishable from an org with no services. */}
            {isServicesError && (
              <p className="text-destructive text-sm">
                Couldn&apos;t load your services.
              </p>
            )}
          </Field>

          {serviceId && (
            <div className="space-y-3">
              {isFormsError ? (
                // BEFORE the empty state: `forms` falls back to [] on a failed
                // request, so an org with forms was told to "create one first"
                // — and saving from that state would have written an empty set,
                // unlinking every form the service already had.
                <p className="text-destructive text-sm">
                  Couldn&apos;t load your forms. Close and reopen this dialog to
                  try again.
                </p>
              ) : forms.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  You have no forms yet. Create one first.
                </p>
              ) : (
                forms.map((form) => {
                  const sel = selection[form.id];
                  return (
                    <div
                      key={form.id}
                      className="flex items-center justify-between gap-3 rounded-md border p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id={`link-${form.id}`}
                          checked={sel?.checked ?? false}
                          onCheckedChange={(c) =>
                            patch(form.id, { checked: c === true })
                          }
                        />
                        <Label htmlFor={`link-${form.id}`}>{form.name}</Label>
                      </div>
                      {sel?.checked && (
                        <div className="flex items-center gap-2">
                          <Label
                            htmlFor={`blocks-${form.id}`}
                            className="text-muted-foreground text-xs"
                          >
                            Required
                          </Label>
                          <Switch
                            id={`blocks-${form.id}`}
                            checked={sel?.blocksBooking ?? false}
                            onCheckedChange={(c) =>
                              patch(form.id, { blocksBooking: c })
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {/* Saving REPLACES the service's whole set. With `forms` empty
              because the request failed, `handleSave` sends [] and silently
              unlinks every form the service already had — so a failed load
              must block the save, not just warn about it. */}
          <Button
            onClick={handleSave}
            disabled={!serviceId || isSaving || isFormsError}
          >
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
