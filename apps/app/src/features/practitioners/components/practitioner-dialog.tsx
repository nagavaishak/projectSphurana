import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreatePractitioner,
  useUpdatePractitioner,
} from '@/features/practitioners';
import { updatePractitionerForm } from '@/features/practitioners/api/update-practitioner';
import { WageConfigForm } from '@/features/scheduling';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { useEffect, useState } from 'react';

/**
 * Labels come from the form declaration — see `update-practitioner.form.ts`.
 * `title` is the exception: this dialog calls it "Title" while the team-member
 * editor calls it "Job title", so the contract pins this control with a
 * per-surface fill rather than forcing one visible label on both.
 */
const L = updatePractitionerForm.labels;

interface PractitionerFormState {
  name: string;
  email: string;
  phone: string;
  title: string;
  bio: string;
}

const emptyForm: PractitionerFormState = {
  name: '',
  email: '',
  phone: '',
  title: '',
  bio: '',
};

interface PractitionerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  practitioner?: PractitionerWithRelations | null;
  onSuccess?: () => void;
}

export function PractitionerDialog({
  open,
  onOpenChange,
  practitioner,
  onSuccess,
}: PractitionerDialogProps) {
  const isEditing = !!practitioner;

  const [formState, setFormState] = useState<PractitionerFormState>(emptyForm);

  useEffect(() => {
    if (open) {
      if (practitioner) {
        setFormState({
          name: practitioner.name,
          email: practitioner.email,
          phone: practitioner.phone ?? '',
          title: practitioner.title ?? '',
          bio: practitioner.bio ?? '',
        });
      } else {
        setFormState(emptyForm);
      }
    }
  }, [open, practitioner]);

  const { createPractitioner, isCreating } = useCreatePractitioner({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const { updatePractitioner, isUpdating } = useUpdatePractitioner({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess?.();
    },
  });

  const handleSubmit = () => {
    if (!formState.name.trim() || !formState.email.trim()) return;

    if (isEditing && practitioner) {
      // Pass raw intent — the shared builder trims and maps empties to null,
      // the same normalisation the team-member editor and wizard use.
      updatePractitioner({
        id: practitioner.id,
        name: formState.name,
        email: formState.email,
        phone: formState.phone,
        title: formState.title,
        bio: formState.bio,
      });
    } else {
      createPractitioner({
        name: formState.name,
        email: formState.email,
        phone: formState.phone || undefined,
        title: formState.title || undefined,
        bio: formState.bio || undefined,
      });
    }
  };

  const isSaving = isCreating || isUpdating;

  const profileFields = (
    <div className="flex flex-col gap-4 py-2">
      <Field>
        <FieldLabel htmlFor="practitioner-name">{L.name}</FieldLabel>
        <Input
          id="practitioner-name"
          placeholder="e.g. Jane Smith"
          value={formState.name}
          onChange={(e) => setFormState({ ...formState, name: e.target.value })}
          autoFocus={!isEditing}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="practitioner-email">{L.email}</FieldLabel>
        <Input
          id="practitioner-email"
          type="email"
          placeholder="e.g. johndoe@example.com"
          value={formState.email}
          onChange={(e) =>
            setFormState({ ...formState, email: e.target.value })
          }
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="practitioner-phone">{L.phone}</FieldLabel>
        <Input
          id="practitioner-phone"
          type="tel"
          placeholder="e.g. +353 1 234 5678"
          value={formState.phone}
          onChange={(e) =>
            setFormState({ ...formState, phone: e.target.value })
          }
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="practitioner-title">Title</FieldLabel>
        <Input
          id="practitioner-title"
          placeholder="e.g. Senior Stylist"
          value={formState.title}
          onChange={(e) =>
            setFormState({ ...formState, title: e.target.value })
          }
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="practitioner-bio">{L.bio}</FieldLabel>
        <Textarea
          id="practitioner-bio"
          placeholder="A short bio about this practitioner..."
          rows={3}
          value={formState.bio}
          onChange={(e) => setFormState({ ...formState, bio: e.target.value })}
        />
      </Field>
    </div>
  );

  const profileFooter = (
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button
        onClick={handleSubmit}
        disabled={!formState.name.trim() || !formState.email.trim() || isSaving}
      >
        {isSaving ? 'Saving...' : isEditing ? 'Update' : 'Add'}
      </Button>
    </DialogFooter>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit Practitioner' : 'Add Practitioner'}
          </DialogTitle>
        </DialogHeader>

        {isEditing && practitioner ? (
          <Tabs defaultValue="profile">
            <TabsList>
              <TabsTrigger value="profile">Profile</TabsTrigger>
              <TabsTrigger value="wages">Wages</TabsTrigger>
            </TabsList>
            <TabsContent value="profile">
              {profileFields}
              {profileFooter}
            </TabsContent>
            <TabsContent value="wages">
              <WageConfigForm practitionerId={practitioner.id} />
            </TabsContent>
          </Tabs>
        ) : (
          <>
            {profileFields}
            {profileFooter}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
