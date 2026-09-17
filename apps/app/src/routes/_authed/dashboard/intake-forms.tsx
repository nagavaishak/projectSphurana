import { createFileRoute } from '@tanstack/react-router';
import { LinkIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { Button } from '@/components/ui/button';
import {
  IntakeFormBuilderDialog,
  IntakeFormList,
  ServiceIntakeFormsDialog,
} from '@/features/intake-forms';
import { useSeedIntakeTemplates } from '@/features/intake-forms/api';
import type { IntakeForm } from '@/features/intake-forms/api/types';

export const Route = createFileRoute('/_authed/dashboard/intake-forms')({
  component: IntakeFormsPage,
});

function IntakeFormsPage() {
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingForm, setEditingForm] = useState<IntakeForm | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const { seedTemplates, isSeeding } = useSeedIntakeTemplates();

  const openCreate = () => {
    setEditingForm(null);
    setBuilderOpen(true);
  };

  const openEdit = (form: IntakeForm) => {
    setEditingForm(form);
    setBuilderOpen(true);
  };

  return (
    <>
      <title>Intake Forms | Borradh</title>
      <PageShell
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => seedTemplates({})}
              disabled={isSeeding}
            >
              <SparklesIcon className="size-4" />
              {isSeeding ? 'Adding…' : 'Start from templates'}
            </Button>
            <Button variant="outline" onClick={() => setLinkOpen(true)}>
              <LinkIcon className="size-4" />
              Attach to service
            </Button>
            <Button onClick={openCreate}>
              <PlusIcon className="size-4" />
              New form
            </Button>
          </div>
        }
      >
        <IntakeFormList onEdit={openEdit} />
      </PageShell>

      <IntakeFormBuilderDialog
        form={editingForm}
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) setEditingForm(null);
        }}
      />

      <ServiceIntakeFormsDialog open={linkOpen} onOpenChange={setLinkOpen} />
    </>
  );
}
