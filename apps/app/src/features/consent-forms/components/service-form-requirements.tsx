import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';

import { useGetServiceFormRequirements } from '../api/get-service-form-requirements';
import { useListConsentFormTemplates } from '../api/list-consent-form-templates';
import { useUpdateServiceFormRequirements } from '../api/update-service-form-requirements';

/**
 * Self-contained "required consent forms for this service" picker
 * (ENG-647 Phase 2). Renders every active template as a checkbox, checked
 * when the service currently requires it; Save PUTs the full template-id set.
 *
 * Embeddable anywhere a `serviceId` is in scope (service settings, or the
 * consent-forms settings page).
 */
export function ServiceFormRequirements({ serviceId }: { serviceId: string }) {
  const { templates, isLoading: isLoadingTemplates } =
    useListConsentFormTemplates();
  const {
    requirements,
    isLoading: isLoadingRequirements,
    isError,
    refetch,
  } = useGetServiceFormRequirements(serviceId);
  const { updateRequirements, isUpdatingRequirements } =
    useUpdateServiceFormRequirements();

  const serverIds = useMemo(
    () => requirements.map((requirement) => requirement.templateId),
    [requirements]
  );

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Sync local selection whenever the server truth changes (load / refetch).
  useEffect(() => {
    setSelectedIds(serverIds);
  }, [serverIds]);

  const isDirty =
    selectedIds.length !== serverIds.length ||
    selectedIds.some((id) => !serverIds.includes(id));

  const activeTemplates = templates.filter((template) => template.isActive);

  if (isLoadingTemplates || isLoadingRequirements) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-5 w-40" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-muted-foreground text-sm">
          Couldn't load required forms.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (activeTemplates.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No active templates yet — create one first.
      </p>
    );
  }

  const toggle = (templateId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? [...current, templateId]
        : current.filter((id) => id !== templateId)
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {activeTemplates.map((template) => {
          const checkboxId = `service-${serviceId}-template-${template.id}`;
          return (
            <li key={template.id} className="flex items-center gap-2">
              <Checkbox
                id={checkboxId}
                checked={selectedIds.includes(template.id)}
                onCheckedChange={(checked) =>
                  toggle(template.id, checked === true)
                }
              />
              <label htmlFor={checkboxId} className="text-sm">
                {template.title}
              </label>
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        className="self-start"
        disabled={!isDirty || isUpdatingRequirements}
        onClick={() =>
          updateRequirements({ serviceId, templateIds: selectedIds })
        }
      >
        {isUpdatingRequirements ? 'Saving…' : 'Save required forms'}
      </Button>
    </div>
  );
}
