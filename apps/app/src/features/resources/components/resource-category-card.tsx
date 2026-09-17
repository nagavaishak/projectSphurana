import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, MoreVertical, PlusIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

import {
  type Resource,
  type ResourceCategory,
  resourceCategoryKindLabels,
  resourceCategoryKindSingularLabels,
  resourceCountLabel,
} from '../api';
import { RESOURCE_COLOR_HEX } from './resource-colors';
import { summariseResourceHours } from './resource-hours-summary';

interface ResourceCategoryCardProps {
  category: ResourceCategory;
  /** Already sorted by `sortOrder`, then name. */
  resources: Resource[];
  /** Only true when the org actually has more than one location. */
  showLocation: boolean;
  locationNames: Record<string, string>;
  onAddResource: () => void;
  onEditResource: (resource: Resource) => void;
  onDeleteResource: (resource: Resource) => void;
  onToggleResourceActive: (resource: Resource) => void;
  onEditCategory: () => void;
  onDeleteCategory: () => void;
  /** Resource ids in their new order. */
  onReorder: (ids: string[]) => void;
}

/**
 * One category and its rooms, as a CARD GRID rather than a table.
 *
 * A table was the first shape here, copied from `blocked-time-types` — and it
 * was wrong. That page lists many short uniform rows, where a header row earns
 * its keep. A clinic has two to eight rooms, each carrying a colour, an
 * availability sentence and optional specs: few, visual, identity-bearing. A
 * "Name | Active" header above two rows is pure chrome, and the colour — the
 * signal the whole rooms calendar is built on — was reduced to a 6px dot.
 *
 * Cards give the colour real estate, let the meta line wrap naturally, and stop
 * the page reading as a spreadsheet of things the owner is meant to administer
 * rather than a set of rooms they recognise.
 */
export function ResourceCategoryCard({
  category,
  resources,
  showLocation,
  locationNames,
  onAddResource,
  onEditResource,
  onDeleteResource,
  onToggleResourceActive,
  onEditCategory,
  onDeleteCategory,
  onReorder,
}: ResourceCategoryCardProps) {
  const singular = resourceCategoryKindSingularLabels[category.kind];
  const addLabel = `Add ${singular.toLowerCase()}`;

  // Count in the clinic's noun, not the schema's. "1 resource" is the word the
  // database uses; nobody standing at a front desk calls Room 2 a resource —
  // and "equipment" does not take an "s".
  const countLabel = resourceCountLabel(category.kind, resources.length);

  // How many of this category's resources are at OTHER branches.
  //
  // Says out loud what the card would otherwise contradict: the list above is
  // branch-scoped, so a category can read "0 rooms" here and still refuse to
  // be deleted, because deleting a category deletes it for the whole org. The
  // server's refusal explains the same thing; this puts it on screen BEFORE
  // the operator presses the button.
  const elsewhereCount = Math.max(
    (category.resourceCountAllBranches ?? resources.length) - resources.length,
    0
  );

  // The kind badge earns its place only when it says something the category
  // name doesn't. A category literally called "Rooms" badged "Rooms" is noise.
  const kindLabel = resourceCategoryKindLabels[category.kind];
  const showKind =
    kindLabel.toLowerCase() !== category.name.trim().toLowerCase();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Without a distance threshold a tap on the handle registers as a
      // zero-length drag and swallows the click.
      activationConstraint: { distance: 4 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = resources.map((resource) => resource.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    onReorder(arrayMove(ids, from, to));
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <h2 className="font-semibold text-base">{category.name}</h2>
          <span className="text-muted-foreground text-sm">
            {countLabel}
            {elsewhereCount > 0
              ? ` · ${elsewhereCount} at ${
                  elsewhereCount === 1 ? 'another branch' : 'other branches'
                }`
              : ''}
          </span>
          {showKind && <Badge variant="secondary">{kindLabel}</Badge>}
          {!category.isActive && <Badge variant="outline">Inactive</Badge>}
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={onAddResource}
          >
            <PlusIcon className="size-4" />
            {addLabel}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <span className="sr-only">{`Open ${category.name} menu`}</span>
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEditCategory}>Edit</DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={onDeleteCategory}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {resources.length === 0 ? (
        <button
          type="button"
          onClick={onAddResource}
          className="flex w-full flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-muted-foreground text-sm transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <PlusIcon className="size-5" />
          Nothing in this category yet.
          <span className="font-medium text-foreground">{addLabel}</span>
        </button>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={resources.map((resource) => resource.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {resources.map((resource) => (
                <SortableResourceCard
                  key={resource.id}
                  resource={resource}
                  showLocation={showLocation}
                  locationNames={locationNames}
                  onEdit={() => onEditResource(resource)}
                  onDelete={() => onDeleteResource(resource)}
                  onToggleActive={() => onToggleResourceActive(resource)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </section>
  );
}

interface SortableResourceCardProps {
  resource: Resource;
  showLocation: boolean;
  locationNames: Record<string, string>;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: () => void;
}

function SortableResourceCard({
  resource,
  showLocation,
  locationNames,
  onEdit,
  onDelete,
  onToggleActive,
}: SortableResourceCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: resource.id });

  const specEntries = Object.entries(resource.specs ?? {});
  const tint = resource.color ? RESOURCE_COLOR_HEX[resource.color] : undefined;

  // The meta line only says things that are TRUE OF THIS ROOM. Capacity 1 and
  // "all locations" are the defaults every room has; printing them on every
  // card is how a glance surface turns back into a spreadsheet.
  const meta: string[] = [summariseResourceHours(resource.workingHours)];
  if (resource.capacity > 1) meta.push(`${resource.capacity} at once`);
  if (showLocation) {
    meta.push(
      resource.locationId
        ? (locationNames[resource.locationId] ?? 'Unknown location')
        : 'All locations'
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'group relative flex gap-3 overflow-hidden rounded-lg border bg-card p-3 transition-shadow',
        isDragging && 'z-10 shadow-lg',
        !resource.isActive && 'opacity-60'
      )}
    >
      {/* The colour as a real block. It is the room's identity on the rooms
          calendar, so the settings page should teach it, not hint at it. */}
      <span
        aria-hidden="true"
        className={cn(
          'w-1.5 shrink-0 rounded-full',
          !tint && 'bg-muted-foreground/25'
        )}
        style={tint ? { backgroundColor: tint } : undefined}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate font-medium text-sm">{resource.name}</p>

          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              // The handle, not the card: the card carries a switch and a menu,
              // and making the whole thing draggable turns every intended tap
              // into a two-pixel drag.
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${resource.name}`}
              className="cursor-grab touch-none p-1 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 active:cursor-grabbing group-hover:opacity-100"
            >
              <GripVertical className="size-4" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <span className="sr-only">{`Open ${resource.name} menu`}</span>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>Edit</DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={onDelete}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <p className="mt-0.5 truncate text-muted-foreground text-xs">
          {meta.join(' · ')}
        </p>

        {specEntries.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {specEntries.map(([key, value]) => (
              <Badge
                key={key}
                variant="outline"
                className="font-normal text-xs"
              >
                {key}: {value}
              </Badge>
            ))}
          </div>
        )}

        <div className="mt-2.5 flex items-center gap-2">
          <Switch
            checked={resource.isActive}
            onCheckedChange={onToggleActive}
            aria-label={`${resource.name} active`}
            className="scale-90"
          />
          <span className="text-muted-foreground text-xs">
            {resource.isActive ? 'Bookable' : 'Not bookable'}
          </span>
        </div>
      </div>
    </div>
  );
}
