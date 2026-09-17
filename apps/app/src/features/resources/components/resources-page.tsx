import { DoorOpen, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useListLocations } from '@/features/organization-locations';

import {
  MAX_RESOURCE_CATEGORIES,
  type Resource,
  type ResourceCategory,
  useCreateResourceCategory,
  useDeleteResource,
  useDeleteResourceCategory,
  useListResourceCategories,
  useListResources,
  useReorderResources,
  useUpdateResource,
  useUpdateResourceCategory,
} from '../api';
import { ResourceCategoryCard } from './resource-category-card';
import { ResourceCategoryFormDialog } from './resource-category-form-dialog';
import {
  ResourceDeleteConfirmDialog,
  ResourceDeleteGuardDialog,
} from './resource-delete-dialogs';
import { ResourceFormDialog } from './resource-form-dialog';

type DeleteTarget = { kind: 'resource' | 'category'; id: string; name: string };
type GuardTarget = DeleteTarget & { message: string };

const byOrderThenName = <T extends { sortOrder: number; name: string }>(
  a: T,
  b: T
) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Settings → Rooms & equipment.
 *
 * Grouped by category, because a category is the unit a service binds to
 * ("this treatment needs a room AND a laser"), so the grouping the user
 * arranges here is the grouping the booking engine reasons about.
 */
export function ResourcesPage() {
  const {
    categories,
    isLoading: isLoadingCategories,
    isError: isCategoriesError,
    error: categoriesError,
  } = useListResourceCategories();

  // `includeInactive` so staff can find and REACTIVATE a deactivated room.
  // Every booking surface asks for the default (active only).
  const {
    resources,
    isLoading: isLoadingResources,
    isError: isResourcesError,
    error: resourcesError,
  } = useListResources({ includeInactive: true });

  const { locations } = useListLocations();
  // A single-site clinic must not see a column whose value is identical on
  // every row.
  const showLocation = locations.length > 1;
  const locationNames = useMemo(
    () =>
      locations.reduce<Record<string, string>>((acc, location, index) => {
        // A location's name is nullable in the schema — an unnamed site still
        // needs something a staff member can tell apart from the others.
        acc[location.id] = location.name ?? `Location ${index + 1}`;
        return acc;
      }, {}),
    [locations]
  );

  const sortedCategories = useMemo(
    () => [...categories].sort(byOrderThenName),
    [categories]
  );

  const resourcesByCategory = useMemo(() => {
    const grouped = new Map<string, Resource[]>();
    for (const resource of resources) {
      const bucket = grouped.get(resource.categoryId);
      if (bucket) bucket.push(resource);
      else grouped.set(resource.categoryId, [resource]);
    }
    for (const bucket of grouped.values()) bucket.sort(byOrderThenName);
    return grouped;
  }, [resources]);

  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] =
    useState<ResourceCategory | null>(null);

  const [resourceDialogOpen, setResourceDialogOpen] = useState(false);
  const [editingResource, setEditingResource] = useState<Resource | null>(null);
  const [resourceDialogCategoryId, setResourceDialogCategoryId] = useState<
    string | undefined
  >(undefined);

  const [pendingDelete, setPendingDelete] = useState<DeleteTarget | null>(null);
  const [guard, setGuard] = useState<GuardTarget | null>(null);

  const { updateResource, isUpdating: isUpdatingResource } =
    useUpdateResource();
  const { updateCategory, isUpdating: isUpdatingCategory } =
    useUpdateResourceCategory();
  const { reorderResources } = useReorderResources();

  // Both delete hooks answer a 409 through `onConflict` instead of the generic
  // error toast — see `api/conflict.ts`. The guard dialog is where that lands.
  const { deleteResource, isDeleting: isDeletingResource } = useDeleteResource({
    onSuccess: () => setPendingDelete(null),
    onError: () => setPendingDelete(null),
    onConflict: (conflict, id) => {
      setPendingDelete(null);
      setGuard({
        kind: 'resource',
        id,
        name: resources.find((item) => item.id === id)?.name ?? 'This resource',
        message: conflict.message,
      });
    },
  });

  const { deleteCategory, isDeleting: isDeletingCategory } =
    useDeleteResourceCategory({
      onSuccess: () => setPendingDelete(null),
      onError: () => setPendingDelete(null),
      onConflict: (conflict, id) => {
        setPendingDelete(null);
        setGuard({
          kind: 'category',
          id,
          name:
            categories.find((item) => item.id === id)?.name ?? 'This category',
          message: conflict.message,
        });
      },
    });

  const { createCategoryAsync, isCreating: isCreatingCategory } =
    useCreateResourceCategory();

  const openAddResource = (categoryId?: string) => {
    setEditingResource(null);
    setResourceDialogCategoryId(categoryId);
    setResourceDialogOpen(true);
  };

  const openEditResource = (resource: Resource) => {
    setEditingResource(resource);
    setResourceDialogCategoryId(undefined);
    setResourceDialogOpen(true);
  };

  const openAddCategory = () => {
    setEditingCategory(null);
    setCategoryDialogOpen(true);
  };

  const openEditCategory = (category: ResourceCategory) => {
    setEditingCategory(category);
    setCategoryDialogOpen(true);
  };

  /**
   * FIRST VISIT: one button, not two steps.
   *
   * A clinic with zero rooms should not have to understand "categories" before
   * it can name its first room, so the CTA creates the obvious "Rooms"
   * category and opens the add-room dialog on top of it.
   */
  const handleSetUpRooms = async () => {
    try {
      const category = await createCategoryAsync({
        name: 'Rooms',
        kind: 'room',
      });
      openAddResource(category.id);
    } catch {
      // The mutation hook already surfaced the failure.
    }
  };

  const handleConfirmDelete = () => {
    if (!pendingDelete) return;
    if (pendingDelete.kind === 'resource') deleteResource(pendingDelete.id);
    else deleteCategory(pendingDelete.id);
  };

  /** The 409's way out: keep the row and its history, stop it being bookable. */
  const handleDeactivateInstead = () => {
    if (!guard) return;
    if (guard.kind === 'resource') {
      updateResource({ id: guard.id, isActive: false });
    } else {
      updateCategory({ id: guard.id, isActive: false });
    }
    setGuard(null);
  };

  const handleReorder = (ids: string[]) => {
    reorderResources({
      items: ids.map((id, index) => ({ id, sortOrder: index })),
    });
  };

  const isLoading = isLoadingCategories || isLoadingResources;
  const isError = isCategoriesError || isResourcesError;
  const loadError = categoriesError ?? resourcesError;
  const hasCategories = sortedCategories.length > 0;
  const atCategoryLimit = sortedCategories.length >= MAX_RESOURCE_CATEGORIES;

  return (
    <>
      <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Rooms &amp; equipment</h1>
            <p className="text-muted-foreground">
              The things a booking needs besides a person — treatment rooms,
              lasers, chairs.
            </p>
          </div>
          {/*
            Deliberately absent on first visit: the empty state's single CTA is
            the only thing a clinic with no rooms should be looking at.
          */}
          {hasCategories &&
            !isLoading &&
            !isError &&
            // At the cap the button goes, rather than staying and failing: an
            // action the API will always refuse is worse than no action.
            (atCategoryLimit ? (
              <p className="text-muted-foreground text-sm">
                {MAX_RESOURCE_CATEGORIES} of {MAX_RESOURCE_CATEGORIES}{' '}
                categories used
              </p>
            ) : (
              <Button className="gap-1.5" onClick={openAddCategory}>
                <PlusIcon className="size-4" />
                Add category
              </Button>
            ))}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertTitle>Couldn&apos;t load rooms &amp; equipment</AlertTitle>
            <AlertDescription>
              {loadError?.message ?? 'Please try again in a moment.'}
            </AlertDescription>
          </Alert>
        ) : !hasCategories ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <DoorOpen />
              </EmptyMedia>
              <EmptyTitle>Set up your rooms</EmptyTitle>
              <EmptyDescription>
                Bookings will stop double-booking a room once it knows the room
                exists.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button
                className="gap-1.5"
                disabled={isCreatingCategory}
                onClick={handleSetUpRooms}
              >
                <PlusIcon className="size-4" />
                {isCreatingCategory ? 'Setting up...' : 'Add your first room'}
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="flex flex-col gap-6">
            {sortedCategories.map((category) => (
              <ResourceCategoryCard
                key={category.id}
                category={category}
                resources={resourcesByCategory.get(category.id) ?? []}
                showLocation={showLocation}
                locationNames={locationNames}
                onAddResource={() => openAddResource(category.id)}
                onEditResource={openEditResource}
                onDeleteResource={(resource) =>
                  setPendingDelete({
                    kind: 'resource',
                    id: resource.id,
                    name: resource.name,
                  })
                }
                onToggleResourceActive={(resource) =>
                  updateResource({
                    id: resource.id,
                    isActive: !resource.isActive,
                  })
                }
                onEditCategory={() => openEditCategory(category)}
                onDeleteCategory={() =>
                  setPendingDelete({
                    kind: 'category',
                    id: category.id,
                    name: category.name,
                  })
                }
                onReorder={handleReorder}
              />
            ))}
          </div>
        )}
      </PageShell>

      <ResourceCategoryFormDialog
        open={categoryDialogOpen}
        onOpenChange={setCategoryDialogOpen}
        category={editingCategory}
      />

      <ResourceFormDialog
        open={resourceDialogOpen}
        onOpenChange={setResourceDialogOpen}
        categories={sortedCategories}
        defaultCategoryId={resourceDialogCategoryId}
        resource={editingResource}
        // Colours already spoken for in the category being added to, so a new
        // room picks an unused one instead of defaulting to "no colour".
        takenColors={resources
          .filter((r) => r.categoryId === resourceDialogCategoryId)
          .map((r) => r.color)}
      />

      <ResourceDeleteConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        title={`Delete ${pendingDelete?.name ?? 'this'}?`}
        description={
          pendingDelete?.kind === 'category'
            ? 'The category is removed from your settings. Resources inside it must be moved or deleted first.'
            : 'The resource stops appearing on the calendar. Past appointments keep their history.'
        }
        isDeleting={isDeletingResource || isDeletingCategory}
        onConfirm={handleConfirmDelete}
      />

      <ResourceDeleteGuardDialog
        open={guard !== null}
        onOpenChange={(open) => {
          if (!open) setGuard(null);
        }}
        title={`Can't delete ${guard?.name ?? 'this'} yet`}
        message={guard?.message ?? ''}
        isDeactivating={isUpdatingResource || isUpdatingCategory}
        onDeactivate={handleDeactivateInstead}
      />
    </>
  );
}
