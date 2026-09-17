import { zodResolver } from '@hookform/resolvers/zod';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { LocationsTab, MembersTab } from '@/components/app/org-settings/tabs';
import { PageShell } from '@/components/app/page-shell';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useActiveOrganization,
  useGetOrganization,
  useUpdateOrganization,
} from '@/features/organization';
import {
  updateOrganizationFields,
  updateOrganizationForm,
} from '@/features/organization/api/update-organization/update-organization.form';
import { WebsiteScanDialog } from '@/features/website-analysis';

export const Route = createFileRoute('/_authed/dashboard/settings/details')({
  component: OrganizationDetailsPage,
});

// This surface OWNS name / websiteUrl / privacyPolicyUrl. Its schema is sliced
// out of the one org-settings declaration, so it cannot validate `name`
// differently from the org-settings dialog's details tab.
const F = updateOrganizationFields;

const detailsSchema = z.object({
  name: F.name.schema,
  websiteUrl: F.websiteUrl.schema,
  privacyPolicyUrl: F.privacyPolicyUrl.schema,
});

type DetailsInput = z.infer<typeof detailsSchema>;

// Exported for the update-organization form contract (drives this surface's own
// UI against the org-settings details tab).
export function DetailsCard() {
  const L = updateOrganizationForm.labels;
  const { data: activeOrg } = useActiveOrganization();
  const { organization } = useGetOrganization(activeOrg?.id ?? '');
  const { execute: updateOrganization, isExecuting } = useUpdateOrganization();

  const form = useForm<DetailsInput>({
    resolver: zodResolver(detailsSchema),
    defaultValues: { name: '', websiteUrl: '', privacyPolicyUrl: '' },
  });

  const { reset } = form;
  useEffect(() => {
    if (organization) {
      reset({
        name: organization.name ?? '',
        websiteUrl: organization.websiteUrl ?? '',
        privacyPolicyUrl: organization.privacyPolicyUrl ?? '',
      });
    }
  }, [organization, reset]);

  const onSubmit = (values: DetailsInput) =>
    // Pass raw form values as intent; the shared builder owns normalisation
    // (empty URL → null), so this matches the details tab's `name` handling.
    updateOrganization({
      name: values.name,
      websiteUrl: values.websiteUrl,
      privacyPolicyUrl: values.privacyPolicyUrl,
    });

  return (
    <form noValidate onSubmit={form.handleSubmit(onSubmit)}>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Your organisation's name, website and privacy policy.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="gap-6">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{L.name}</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    id={field.name}
                    placeholder="Your business name"
                  />
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="websiteUrl"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{L.websiteUrl}</FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    id={field.name}
                    placeholder="https://..."
                    type="url"
                  />
                  <FieldDescription>
                    We can read this site and fill in your services, prices,
                    opening hours, team and more — you review every change
                    before it is saved.
                  </FieldDescription>
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                  <div className="pt-1">
                    <WebsiteScanDialog
                      disabled={!field.value?.trim()}
                      websiteUrl={field.value ?? ''}
                    />
                  </div>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="privacyPolicyUrl"
              render={({ field, fieldState }) => (
                <Field className="gap-2" data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>
                    {L.privacyPolicyUrl}
                  </FieldLabel>
                  <Input
                    {...field}
                    aria-invalid={fieldState.invalid}
                    id={field.name}
                    placeholder="https://..."
                    type="url"
                  />
                  <FieldDescription>
                    Used to prefill Meta lead forms.
                  </FieldDescription>
                  {fieldState.error ? (
                    <FieldError errors={[fieldState.error]} />
                  ) : null}
                </Field>
              )}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            disabled={isExecuting || !form.formState.isDirty}
            type="submit"
          >
            {isExecuting ? 'Saving...' : 'Save changes'}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}

function OrganizationDetailsPage() {
  const { data: activeOrg } = useActiveOrganization();
  const { organization, isLoading } = useGetOrganization(activeOrg?.id ?? '');

  if (isLoading && !organization) {
    return (
      <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
        <title>Organisation Details | Borradh</title>
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </PageShell>
    );
  }

  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Organisation Details | Borradh</title>

      <DetailsCard />

      <Card>
        <CardHeader>
          <CardTitle>Members</CardTitle>
          <CardDescription>
            People with access to this organisation.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <MembersTab />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Locations</CardTitle>
          <CardDescription>Where your business operates.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <LocationsTab />
        </CardContent>
      </Card>
    </PageShell>
  );
}
