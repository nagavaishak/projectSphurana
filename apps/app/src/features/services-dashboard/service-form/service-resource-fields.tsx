import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ResourceCategoryKind } from '@borradh-workspace/api-client/types';
import {
  resourceCategoryKindRequiresLabels,
  resourceCategoryKindSingularLabels,
} from '@borradh-workspace/labels';
import { MinusIcon, PlusIcon } from 'lucide-react';
import { useId } from 'react';

import type { ServiceFieldVariant } from './service-form-fields';
import {
  type ResourceRequirementDraft,
  TURNAROUND_MAX,
  TURNAROUND_MIN,
  TURNAROUND_STEP,
  clampTurnaround,
} from './service-form-schema';

/**
 * "Rooms & equipment" — which non-human thing a service occupies, and for how
 * long the room stays held afterwards.
 *
 * PROGRESSIVE DISCLOSURE: these controls only exist for an org that has
 * actually set up rooms/equipment. Every clinic starts with none, and for those
 * the service form must look EXACTLY as it did before this feature — hence the
 * surfaces pass an empty `groups` and this file renders nothing.
 */

/** A resource category paired with the resources a service can be narrowed to. */
export interface ResourceCategoryGroup {
  category: { id: string; name: string; kind: ResourceCategoryKind };
  /** Assignable (active) resources in the category. Never empty — see above. */
  resources: Array<{ id: string; name: string }>;
}

export interface ResourceRequirementHandlers {
  groups: ResourceCategoryGroup[];
  drafts: ResourceRequirementDraft[];
  /** Turn the whole category requirement on/off. On defaults to "any". */
  onToggleCategory: (categoryId: string) => void;
  /** Add/remove one specific resource from a category's eligible list. */
  onToggleResource: (categoryId: string, resourceId: string) => void;
  /** Widen back to "any resource in this category" (clears the eligible list). */
  onSelectAnyResource: (categoryId: string) => void;
  /**
   * The service's saved requirements could not be loaded, so `drafts` is empty
   * for a reason that has nothing to do with the service. Editing here would
   * replace real rules with nothing.
   */
  requirementsError?: boolean;
}

/**
 * Minutes the ROOM stays blocked after the appointment ends.
 *
 * The wording matters: turnaround holds the resource, not the practitioner, so
 * a clinician is free straight away for a service that needs no room. It also
 * does not extend the appointment the customer sees.
 */
export function ServiceTurnaroundField({
  value,
  onChange,
  variant = 'desktop',
}: {
  value: number;
  onChange: (value: number) => void;
  variant?: ServiceFieldVariant;
}) {
  const id = useId();
  const isMobile = variant === 'mobile';

  const step = (direction: -1 | 1) =>
    onChange(clampTurnaround(value + direction * TURNAROUND_STEP));

  return (
    <Field>
      <FieldLabel
        htmlFor={id}
        className={cn(
          isMobile
            ? 'text-[13px] font-medium text-[#8E8E93]'
            : 'text-muted-foreground font-normal'
        )}
      >
        Turnaround time
      </FieldLabel>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Decrease turnaround time"
          disabled={value <= TURNAROUND_MIN}
          onClick={() => step(-1)}
          className={isMobile ? 'size-11 shrink-0 rounded-lg' : 'shrink-0'}
        >
          <MinusIcon className="size-4" />
        </Button>
        <InputGroup className={isMobile ? 'h-11 rounded-lg' : undefined}>
          <InputGroupInput
            id={id}
            type="number"
            inputMode="numeric"
            min={TURNAROUND_MIN}
            max={TURNAROUND_MAX}
            step={TURNAROUND_STEP}
            value={String(value)}
            onChange={(e) =>
              onChange(clampTurnaround(Number(e.target.value || 0)))
            }
          />
          {/* Suffix, like the price field's currency prefix: "15 min" is the
              unit reading, "min 15" is not. */}
          <InputGroupAddon
            align="inline-end"
            className="bg-muted text-foreground"
          >
            min
          </InputGroupAddon>
        </InputGroup>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Increase turnaround time"
          disabled={value >= TURNAROUND_MAX}
          onClick={() => step(1)}
          className={isMobile ? 'size-11 shrink-0 rounded-lg' : 'shrink-0'}
        >
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <FieldDescription>
        Time the room stays blocked after the appointment for cleanup. Doesn't
        extend the appointment.
      </FieldDescription>
    </Field>
  );
}

/**
 * One switch per resource category, plus (when on) the eligible-resource
 * picker that narrows it from "any".
 */
export function ServiceResourceRequirementsField({
  groups,
  drafts,
  onToggleCategory,
  onToggleResource,
  onSelectAnyResource,
  requirementsError,
  variant = 'desktop',
  idPrefix = 'service',
}: ResourceRequirementHandlers & {
  variant?: ServiceFieldVariant;
  idPrefix?: string;
}) {
  // The org has no rooms or equipment: the whole feature stays invisible.
  if (groups.length === 0) return null;

  const isMobile = variant === 'mobile';

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold">Rooms &amp; equipment</p>
        <p className="text-muted-foreground text-xs">
          What this service needs to occupy. Bookings only offer times when a
          matching resource is free.
        </p>
      </div>

      {requirementsError ? (
        <p role="alert" className="text-destructive text-sm">
          Couldn&apos;t load this service&apos;s rooms &amp; equipment. Close
          and reopen to try again — editing now would replace the saved rules.
        </p>
      ) : (
        groups.map((group) => (
          <ResourceCategoryRow
            key={group.category.id}
            group={group}
            draft={drafts.find((d) => d.categoryId === group.category.id)}
            isMobile={isMobile}
            idPrefix={idPrefix}
            onToggleCategory={onToggleCategory}
            onToggleResource={onToggleResource}
            onSelectAnyResource={onSelectAnyResource}
          />
        ))
      )}
    </div>
  );
}

function ResourceCategoryRow({
  group,
  draft,
  isMobile,
  idPrefix,
  onToggleCategory,
  onToggleResource,
  onSelectAnyResource,
}: {
  group: ResourceCategoryGroup;
  draft: ResourceRequirementDraft | undefined;
  isMobile: boolean;
  idPrefix: string;
  onToggleCategory: (categoryId: string) => void;
  onToggleResource: (categoryId: string, resourceId: string) => void;
  onSelectAnyResource: (categoryId: string) => void;
}) {
  const { category, resources } = group;
  const switchId = `${idPrefix}-requires-${category.id}`;
  const anyId = `${idPrefix}-any-${category.id}`;
  const singular = resourceCategoryKindSingularLabels[category.kind];
  const singularLower = singular.toLowerCase();
  const required = draft != null;
  // EMPTY eligible list = ANY resource in the category qualifies (not "none").
  const isAny = required && draft.eligibleResourceIds.length === 0;

  return (
    <div
      className={cn(
        'rounded-md border',
        isMobile && 'rounded-lg border-[#E5E5E5]'
      )}
    >
      <Field orientation="horizontal" className="p-3">
        <div className="flex flex-col gap-0.5">
          <FieldLabel htmlFor={switchId} className="font-medium">
            {resourceCategoryKindRequiresLabels[category.kind]}
          </FieldLabel>
          <FieldDescription>{category.name}</FieldDescription>
        </div>
        <Switch
          id={switchId}
          checked={required}
          onCheckedChange={() => onToggleCategory(category.id)}
        />
      </Field>

      {required && (
        <div className="flex flex-col gap-1 border-t p-3">
          <label htmlFor={anyId} className="flex items-center gap-3 py-1">
            <Checkbox
              id={anyId}
              checked={isAny}
              // Re-checking "Any" widens back; it is never a no-op toggle off.
              onCheckedChange={() => onSelectAnyResource(category.id)}
            />
            <span className="text-sm font-medium">Any {singularLower}</span>
          </label>
          {resources.map((resource) => {
            const checkboxId = `${idPrefix}-resource-${resource.id}`;
            return (
              <label
                key={resource.id}
                htmlFor={checkboxId}
                className="flex items-center gap-3 py-1"
              >
                <Checkbox
                  id={checkboxId}
                  checked={draft.eligibleResourceIds.includes(resource.id)}
                  onCheckedChange={() =>
                    onToggleResource(category.id, resource.id)
                  }
                />
                <span className="text-sm">{resource.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
