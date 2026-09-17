import { zodResolver } from '@hookform/resolvers/zod';
import { ChevronRight, MinusIcon, PlusIcon } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
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
import { Switch } from '@/components/ui/switch';
import { useListLocations } from '@/features/organization-locations';
import { cn } from '@/lib/utils';

import {
  type CreateResourceInput,
  type Resource,
  type ResourceCategory,
  type ResourceSpecs,
  resourceCategoryKindSingularLabels,
  useCreateResource,
  useUpdateResource,
} from '../api';
import { ResourceColorPicker } from './resource-color-picker';
import { type ResourceColor, resourceColorValues } from './resource-colors';
import {
  MAX_SPEC_LENGTH,
  MAX_SPEC_ROWS,
  ResourceSpecsEditor,
} from './resource-specs-editor';
import {
  ResourceWorkingHoursEditor,
  toResourceWorkingHours,
  toWeeklyHours,
} from './resource-working-hours-editor';

/** "All locations" — a trolley-mounted device that travels between sites. */
const ANY_LOCATION = '__any__';

export const MAX_RESOURCE_CAPACITY = 50;

const resourceFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    categoryId: z.string().min(1, 'Pick a category'),
    /** '' = every location. */
    locationId: z.string(),
    /** '' = no calendar tint. */
    color: z.string(),
    capacity: z
      .number()
      .int('Capacity must be a whole number')
      .min(1, 'Capacity must be at least 1')
      .max(
        MAX_RESOURCE_CAPACITY,
        `Capacity must be ${MAX_RESOURCE_CAPACITY} or fewer`
      ),
    specs: z
      .array(
        z.object({
          key: z
            .string()
            .max(
              MAX_SPEC_LENGTH,
              `Spec names must be ${MAX_SPEC_LENGTH} characters or fewer`
            ),
          value: z
            .string()
            .max(
              MAX_SPEC_LENGTH,
              `Spec values must be ${MAX_SPEC_LENGTH} characters or fewer`
            ),
        })
      )
      .max(MAX_SPEC_ROWS, `Up to ${MAX_SPEC_ROWS} specs`),
    alwaysAvailable: z.boolean(),
    workingHours: z.record(
      z.string(),
      z.object({ from: z.number(), to: z.number() })
    ),
  })
  .refine(
    (data) => data.alwaysAvailable || Object.keys(data.workingHours).length > 0,
    {
      message:
        'Pick at least one day, or switch "Always available" back on — with no days it can never be booked.',
      path: ['workingHours'],
    }
  );

type ResourceFormData = z.infer<typeof resourceFormSchema>;

/** First palette colour not already used here; falls back to cycling. */
function nextFreeColor(taken: (ResourceColor | null)[] | undefined): string {
  const used = new Set((taken ?? []).filter(Boolean) as ResourceColor[]);
  const free = resourceColorValues.find((c) => !used.has(c));
  return free ?? resourceColorValues[used.size % resourceColorValues.length];
}

interface ResourceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: ResourceCategory[];
  /** Preselects the category when adding from inside one. */
  defaultCategoryId?: string;
  /** When set, the dialog edits this resource instead of creating one. */
  resource?: Resource | null;
  /**
   * Colours already in use in this category. A new resource takes the first
   * UNUSED palette colour so the rooms calendar is legible the moment it is
   * opened — leaving colour unset ships the feature's main visual signal in
   * its "off" state, and nobody goes back to fill it in.
   */
  takenColors?: (ResourceColor | null)[];
}

/**
 * Create/edit one room or piece of equipment.
 *
 * ⚠️ AVAILABILITY IS INVERTED ON PURPOSE. `workingHours: null` means ALWAYS
 * AVAILABLE — the resource simply inherits the clinic's opening hours. So the
 * "Always available" switch being ON must send `null`, NOT an object with
 * every day filled in. Sending a filled object instead would pin the room to
 * whatever hours this form happened to default to, and it would stop being
 * bookable the moment the clinic's own hours moved outside them. Getting this
 * backwards is the single most damaging bug this dialog can ship.
 */
export function ResourceFormDialog({
  open,
  onOpenChange,
  categories,
  defaultCategoryId,
  resource,
  takenColors,
}: ResourceFormDialogProps) {
  const isEditing = !!resource;
  const formId = useId();
  const { locations } = useListLocations();
  // A single-site clinic must not be asked to pick between one option.
  const showLocation = locations.length > 1;

  const defaultValues = useMemo<ResourceFormData>(
    () => ({
      name: resource?.name ?? '',
      categoryId:
        resource?.categoryId ?? defaultCategoryId ?? categories[0]?.id ?? '',
      locationId: resource?.locationId ?? '',
      color: resource?.color ?? nextFreeColor(takenColors),
      capacity: resource?.capacity ?? 1,
      specs: Object.entries(resource?.specs ?? {}).map(([key, value]) => ({
        key,
        value: String(value),
      })),
      // null (or a brand-new resource) = always available.
      alwaysAvailable: isEditing ? resource?.workingHours == null : true,
      workingHours: toWeeklyHours(resource?.workingHours),
    }),
    [resource, defaultCategoryId, categories, isEditing, takenColors]
  );

  const usesAdvanced =
    (resource?.capacity ?? 1) > 1 ||
    Object.keys(resource?.specs ?? {}).length > 0 ||
    (isEditing && resource?.workingHours != null);
  const [showAdvanced, setShowAdvanced] = useState(usesAdvanced);

  const form = useForm<ResourceFormData>({
    resolver: zodResolver(resourceFormSchema),
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
      setShowAdvanced(usesAdvanced);
      hasSeeded.current = true;
    } else if (!open) {
      hasSeeded.current = false;
    }
  }, [open, defaultValues, form, usesAdvanced]);

  // Follow the SELECTED category, so switching from Rooms to Lasers in the
  // picker retitles the dialog rather than leaving it saying "room".
  const selectedCategoryId = form.watch('categoryId');
  const selectedKind =
    categories.find((c) => c.id === selectedCategoryId)?.kind ?? 'room';
  const noun = resourceCategoryKindSingularLabels[selectedKind];
  const nounLower = noun.toLowerCase();

  const { createResource, isCreating } = useCreateResource({
    noun,
    onSuccess: () => onOpenChange(false),
  });
  const { updateResource, isUpdating } = useUpdateResource({
    onSuccess: () => onOpenChange(false),
  });

  const handleSubmit = (data: ResourceFormData) => {
    const specs = data.specs.reduce<ResourceSpecs>((acc, row) => {
      const key = row.key.trim();
      if (key) acc[key] = row.value.trim();
      return acc;
    }, {});

    const payload: CreateResourceInput = {
      categoryId: data.categoryId,
      name: data.name.trim(),
      color: data.color ? data.color : null,
      capacity: data.capacity,
      specs: Object.keys(specs).length > 0 ? specs : null,
      locationId: data.locationId ? data.locationId : null,
      // ⚠️ null = ALWAYS AVAILABLE. See the dialog's doc comment.
      workingHours: data.alwaysAvailable
        ? null
        : toResourceWorkingHours(data.workingHours),
    };

    if (isEditing && resource) {
      updateResource({ id: resource.id, ...payload });
    } else {
      createResource(payload);
    }
  };

  const isSaving = isCreating || isUpdating;
  const alwaysAvailable = form.watch('alwaysAvailable');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          {/* The clinic's noun, not the schema's — and it must agree with the
              button that opened this dialog ("Add room"). "Resource" is the
              word the database uses; nobody at a front desk calls Room 2 one. */}
          <DialogTitle>
            {isEditing ? `Edit ${nounLower}` : `Add ${nounLower}`}
          </DialogTitle>
          <DialogDescription>
            {noun === 'Equipment'
              ? 'Kit the calendar books alongside your team.'
              : `A ${nounLower} the calendar books alongside your team.`}
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
                  placeholder="e.g. Room 2"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          <Controller
            name="categoryId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Category</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          {showLocation && (
            <Controller
              name="locationId"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Location</FieldLabel>
                  <Select
                    value={field.value === '' ? ANY_LOCATION : field.value}
                    onValueChange={(next) =>
                      field.onChange(next === ANY_LOCATION ? '' : next)
                    }
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ANY_LOCATION}>
                        All locations
                      </SelectItem>
                      {locations.map((location) => (
                        <SelectItem key={location.id} value={location.id}>
                          {location.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          )}

          <Controller
            name="color"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="resource-color">
                  Calendar colour
                </FieldLabel>
                <ResourceColorPicker
                  id="resource-color"
                  value={field.value as ResourceColor | ''}
                  onChange={field.onChange}
                />
              </Field>
            )}
          />

          {/* ── Everything below is the exception, not the rule ──────────────
              A clinic sets a room's NAME and colour; capacity > 1, custom
              specs and per-room hours apply to a minority of rooms. Giving
              them equal billing turned this dialog into a field dump where
              "Capacity" carried the same visual weight as "Name". Collapsed by
              default, and auto-opened when editing a resource that actually
              uses one of them so nothing is ever hidden from the person who
              set it. */}
          <Collapsible
            open={showAdvanced}
            onOpenChange={setShowAdvanced}
            className="border-t pt-4"
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 gap-1.5 text-muted-foreground"
              >
                <ChevronRight
                  className={cn(
                    'size-4 transition-transform',
                    showAdvanced && 'rotate-90'
                  )}
                />
                More options
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <Controller
                name="capacity"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>Capacity</FieldLabel>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9 shrink-0"
                        aria-label="Decrease capacity"
                        disabled={field.value <= 1}
                        onClick={() =>
                          field.onChange(Math.max(1, field.value - 1))
                        }
                      >
                        <MinusIcon className="size-4" />
                      </Button>
                      <Input
                        id={field.name}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={MAX_RESOURCE_CAPACITY}
                        className="w-20 text-center"
                        aria-invalid={fieldState.invalid}
                        value={String(field.value)}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          field.onChange(Number.isNaN(next) ? 1 : next);
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-9 shrink-0"
                        aria-label="Increase capacity"
                        disabled={field.value >= MAX_RESOURCE_CAPACITY}
                        onClick={() =>
                          field.onChange(
                            Math.min(MAX_RESOURCE_CAPACITY, field.value + 1)
                          )
                        }
                      >
                        <PlusIcon className="size-4" />
                      </Button>
                    </div>
                    <FieldDescription>
                      How many appointments can happen here at once?
                    </FieldDescription>
                    {fieldState.error && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="specs"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="resource-spec-0">Specs</FieldLabel>
                    <ResourceSpecsEditor
                      id="resource-spec-0"
                      value={field.value}
                      onChange={field.onChange}
                      invalid={fieldState.invalid}
                    />
                    {fieldState.error && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="alwaysAvailable"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor={field.name}>
                      Always available
                    </FieldLabel>
                    <Switch
                      id={field.name}
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </Field>
                )}
              />
              <FieldDescription>
                On means it's bookable whenever the clinic is open. Turn it off
                only for a {nounLower} with its own hours.
              </FieldDescription>

              {!alwaysAvailable && (
                <Controller
                  name="workingHours"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel>Weekly hours</FieldLabel>
                      <ResourceWorkingHoursEditor
                        value={field.value}
                        onChange={field.onChange}
                      />
                      {fieldState.error && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}
            </CollapsibleContent>
          </Collapsible>
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
