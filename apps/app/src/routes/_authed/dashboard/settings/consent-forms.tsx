import { createFileRoute } from '@tanstack/react-router';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { PageShell } from '@/components/app/page-shell';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type ConsentFormTemplate,
  ConsentFormTemplateDialog,
  ServiceFormRequirements,
  useDeleteConsentFormTemplate,
  useListConsentFormTemplates,
} from '@/features/consent-forms';
import { useListServices } from '@/features/organization-services';

export const Route = createFileRoute(
  '/_authed/dashboard/settings/consent-forms'
)({
  component: ConsentFormsSettingsPage,
});

function ConsentFormsSettingsPage() {
  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Consent Forms | Borradh</title>
      <TemplatesCard />
      <AssignToServicesCard />
    </PageShell>
  );
}

function TemplatesCard() {
  const { templates, isLoading, isError, refetch } =
    useListConsentFormTemplates();
  const { deleteTemplate, isDeleting } = useDeleteConsentFormTemplate();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] =
    useState<ConsentFormTemplate | null>(null);
  const [deletingTemplate, setDeletingTemplate] =
    useState<ConsentFormTemplate | null>(null);

  const openCreate = () => {
    setEditingTemplate(null);
    setBuilderOpen(true);
  };

  const openEdit = (template: ConsentFormTemplate) => {
    setEditingTemplate(template);
    setBuilderOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Consent form templates</CardTitle>
          <CardDescription>
            Forms patients read and sign before their appointment.
          </CardDescription>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" />
          New template
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ) : isError ? (
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Couldn't load templates.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try again
            </Button>
          </div>
        ) : templates.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No templates yet. Create one, then assign it to the services that
            need it.
          </p>
        ) : (
          <ul className="flex flex-col divide-y">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {template.title}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {template.fields.length === 0
                      ? 'No additional fields'
                      : `${template.fields.length} additional field${template.fields.length === 1 ? '' : 's'}`}
                    {template.requiresSignature ? ' · Signature required' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={template.isActive ? 'secondary' : 'outline'}>
                    {template.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit ${template.title}`}
                    onClick={() => openEdit(template)}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete ${template.title}`}
                    onClick={() => setDeletingTemplate(template)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <ConsentFormTemplateDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        template={editingTemplate}
      />

      <ConfirmDeleteDialog
        description="The template will no longer be sent to patients, and services that require it will stop requiring it."
        isPending={isDeleting}
        onConfirm={() => {
          if (deletingTemplate) {
            deleteTemplate(deletingTemplate.id, {
              onSuccess: () => setDeletingTemplate(null),
            });
          }
        }}
        onOpenChange={(open) => {
          if (!open) setDeletingTemplate(null);
        }}
        open={!!deletingTemplate}
        title={<>Delete &ldquo;{deletingTemplate?.title}&rdquo;?</>}
      />
    </Card>
  );
}

/**
 * Per-service required-forms assignment. Lives here (not on the service edit
 * surface) because the service editor is split across a mobile form page and
 * a desktop dialog — embedding there would mean touching two complex surfaces.
 */
function AssignToServicesCard() {
  const { services, isLoading, isError } = useListServices({ limit: 100 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign to services</CardTitle>
        <CardDescription>
          Choose which forms a patient must complete when they book each
          service.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        ) : isError ? (
          <p className="text-muted-foreground text-sm">
            Couldn't load services.
          </p>
        ) : services.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No services yet — add services first.
          </p>
        ) : (
          <Accordion type="multiple" className="w-full">
            {services.map((service) => (
              <AccordionItem key={service.id} value={service.id}>
                <AccordionTrigger className="text-sm">
                  {service.name}
                </AccordionTrigger>
                <AccordionContent>
                  <ServiceFormRequirements serviceId={service.id} />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}
      </CardContent>
    </Card>
  );
}
