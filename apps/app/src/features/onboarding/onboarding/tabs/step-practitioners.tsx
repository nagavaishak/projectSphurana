import {
  AppDialogBody,
  AppDialogFooter,
  AppDialogHeader,
  AppDialogRoot,
} from '@/components/ui/app-dialog';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { FieldError, FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Plus, Users, X } from 'lucide-react';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface StepPractitionersProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

const emptyPractitioner = {
  name: '',
  email: '',
  title: '',
  phone: '',
};

/**
 * Onboarding Step: Practitioners / Team Members
 * Lets the user add team members during onboarding.
 */
export function StepPractitioners({ form }: StepPractitionersProps) {
  const practitioners: Array<{
    id: string;
    name: string;
    email: string;
    title?: string;
    phone?: string;
  }> = form.watch('practitioners') || [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [newPractitioner, setNewPractitioner] = useState({
    ...emptyPractitioner,
  });

  const handleRemovePractitioner = (id: string) => {
    const current = form.getValues('practitioners') || [];
    form.setValue(
      'practitioners',
      current.filter((p: { id: string }) => p.id !== id)
    );
  };

  const handleUpdatePractitionerEmail = (id: string, email: string) => {
    const current = form.getValues('practitioners') || [];
    form.setValue(
      'practitioners',
      current.map((p: { id: string }) => (p.id === id ? { ...p, email } : p)),
      { shouldDirty: true, shouldValidate: true }
    );
  };

  const handleAddPractitioner = () => {
    if (!newPractitioner.name.trim() || !newPractitioner.email.trim()) {
      return;
    }
    const current = form.getValues('practitioners') || [];
    form.setValue('practitioners', [
      ...current,
      {
        id: crypto.randomUUID(),
        name: newPractitioner.name.trim(),
        email: newPractitioner.email.trim(),
        title: newPractitioner.title.trim() || undefined,
        phone: newPractitioner.phone.trim() || undefined,
      },
    ]);
    setNewPractitioner({ ...emptyPractitioner });
    setDialogOpen(false);
  };

  const openDialog = () => {
    setNewPractitioner({ ...emptyPractitioner });
    setDialogOpen(true);
  };

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Add Your Team</h1>
        <p className="text-muted-foreground">
          Add team members who provide services. You can add more later from
          your dashboard.
        </p>
      </div>

      <Controller
        name="practitioners"
        control={form.control}
        render={({ fieldState }) => (
          <>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </>
        )}
      />

      {practitioners.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>No team members added</EmptyTitle>
            <EmptyDescription>
              Add your practitioners, stylists, or staff who provide services.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button type="button" onClick={openDialog}>
              <Plus className="h-4 w-4" />
              Add a team member
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {practitioners.map((p) => (
              <div
                key={p.id}
                className="flex items-start justify-between rounded-md border p-3"
              >
                <div className="flex items-start gap-2">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="text-sm">
                    <p className="font-medium">{p.name}</p>
                    {p.email ? (
                      <p className="text-muted-foreground">{p.email}</p>
                    ) : (
                      <Input
                        type="email"
                        aria-label={`Email address for ${p.name}`}
                        placeholder="Email address *"
                        value={p.email}
                        onChange={(e) =>
                          handleUpdatePractitionerEmail(p.id, e.target.value)
                        }
                        className="mt-1 h-8 w-64"
                      />
                    )}
                    {p.title && (
                      <p className="text-muted-foreground">{p.title}</p>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => handleRemovePractitioner(p.id)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit"
            onClick={openDialog}
          >
            <Plus className="h-4 w-4" />
            Add another team member
          </Button>
        </>
      )}

      <AppDialogRoot open={dialogOpen} onOpenChange={setDialogOpen} size="md">
        <AppDialogHeader
          title="Add a team member"
          description="Add a practitioner or staff member to your team."
          icon={Users}
        />
        <AppDialogBody className="flex flex-col gap-3">
          <Input
            placeholder="Full name *"
            value={newPractitioner.name}
            onChange={(e) =>
              setNewPractitioner((prev) => ({ ...prev, name: e.target.value }))
            }
          />
          <Input
            type="email"
            placeholder="Email address *"
            value={newPractitioner.email}
            onChange={(e) =>
              setNewPractitioner((prev) => ({ ...prev, email: e.target.value }))
            }
          />
          <Input
            placeholder="Title / Role (optional)"
            value={newPractitioner.title}
            onChange={(e) =>
              setNewPractitioner((prev) => ({ ...prev, title: e.target.value }))
            }
          />
          <Input
            type="tel"
            placeholder="Phone (optional)"
            value={newPractitioner.phone}
            onChange={(e) =>
              setNewPractitioner((prev) => ({ ...prev, phone: e.target.value }))
            }
          />
        </AppDialogBody>
        <AppDialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => setDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleAddPractitioner}
            disabled={
              !newPractitioner.name.trim() || !newPractitioner.email.trim()
            }
          >
            Add team member
          </Button>
        </AppDialogFooter>
      </AppDialogRoot>
    </FieldGroup>
  );
}
