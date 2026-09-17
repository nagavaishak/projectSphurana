import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useActiveOrganization } from '@/features/organization';
import {
  isSharedAcrossBranches,
  useActiveLocation,
} from '@/features/organization-locations';
import {
  useDeleteService,
  useListServices,
  useRemoveServiceLocation,
  useUpdateService,
} from '@/features/organization-services';
import { useListCategories } from '@/features/service-categories';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { micrositeBookingUrl } from '@/lib/microsite-url';
import type {
  ListedService,
  OrganizationService,
} from '@borradh-workspace/api-client/types';
import { servicePriceTypeLabels } from '@borradh-workspace/labels';
import { useNavigate } from '@tanstack/react-router';
import { Link2Icon, MoreHorizontal, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ImportServicesCsvDialog } from './import-services-csv-dialog';
import { ImportServicesDialog } from './import-services-dialog';

export function ServicesPage() {
  const { data: activeOrg } = useActiveOrganization();
  const {
    location: activeLocation,
    locations,
    isMultiLocation,
  } = useActiveLocation();
  const { removeServiceLocationAsync, isRemoving } = useRemoveServiceLocation();
  const [importOpen, setImportOpen] = useState(false);
  const [importCsvOpen, setImportCsvOpen] = useState(false);
  // `isActive: undefined` = active AND archived. The hook hides archived rows
  // unless the key is present, which made this page a one-way door: "Archive"
  // removed a service from the only screen that lists services, so there was
  // nowhere left to un-archive it from. The CSV import made that visible —
  // "import as archived, so I can review them" imported services that could
  // never be reviewed. Archived rows carry an "Archived" badge and a Restore
  // action instead.
  const { services, isLoading, isError, error } = useListServices({
    limit: 100,
    isActive: undefined,
  });
  const { categories } = useListCategories();
  const { deleteService } = useDeleteService();
  // Separate update instance for archive so we can use a clearer toast.
  const { updateService: archiveService } = useUpdateService({
    showSuccessToast: false,
  });

  const navigate = useNavigate();
  const { format } = useOrgCurrency();
  const [search, setSearch] = useState('');

  const filteredServices = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return services;
    return services.filter((s) => s.name.toLowerCase().includes(term));
  }, [services, search]);

  // Build accent color per category id

  // Group services by categoryId (or UNCATEGORISED_KEY)

  // Order sections to match the sidebar (categories first, uncategorised last)

  // Create/edit are PAGES now (the unified editor), not dialogs. A category's
  // "Add" button carries its category through as a search param so the new
  // service lands in the right section.
  const openAdd = (_initialCategoryId: string | null = null) =>
    navigate({ to: '/create/$entity', params: { entity: 'service' } });
  const openEdit = (service: ListedService) =>
    navigate({
      to: '/edit/$entity/$id',
      params: { entity: 'service', id: service.id },
    });

  const handleArchive = (service: ListedService) => {
    const restoring = !service.isActive;
    archiveService(
      { id: service.id, isActive: restoring },
      {
        onSuccess: () =>
          toast.success(restoring ? 'Service restored' : 'Service archived'),
      }
    );
  };

  // Was a raw `window.confirm` — an unstyled, unbranded browser dialog that no
  // test could drive. Now the shared destructive confirmation.
  // `ListedService`, not `OrganizationService`: the delete prompt needs the
  // row's `locationIds` to know whether it is deleting from one branch or all.
  const [deleteTarget, setDeleteTarget] = useState<ListedService | null>(null);
  const handleDelete = (service: ListedService) => setDeleteTarget(service);

  const handleCopyBookingLink = () => {
    const slug = activeOrg?.slug;
    if (!slug) return;
    // The CANONICAL customer url, not one that survives on a redirect: this
    // gets pasted into an Instagram bio and lives there for years.
    const url = micrositeBookingUrl(slug);
    navigator.clipboard.writeText(url).then(() => {
      toast.success('Booking link copied to clipboard');
    });
  };

  const categoryName = (service: OrganizationService) =>
    categories.find((category) => category.id === service.categoryId)?.name ??
    'Uncategorised';

  // Which branches this service is on decides whether deleting it is a local
  // act or a business-wide one — see `isSharedAcrossBranches` for why an EMPTY
  // link set counts as shared.
  const sharedAcrossBranches = isSharedAcrossBranches({
    locationIds: deleteTarget?.locationIds,
    totalBranches: locations.length,
  });
  const branchLabel =
    activeLocation?.name ?? activeLocation?.addressLine1 ?? 'this location';

  const columns: ListColumn<ListedService>[] = [
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (service) => <span className="font-medium">{service.name}</span>,
    },
    {
      id: 'category',
      header: 'Category',
      // Categories were a 280px sidebar filter and a set of grouped sections.
      // As a column they are visible on every row, sortable with the rest, and
      // they stop costing a quarter of the page width.
      mobile: 'secondary',
      cell: categoryName,
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: (service) =>
        service.appointmentDuration
          ? `${service.appointmentDuration} min`
          : '—',
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      mobile: 'trailing',
      cell: (service) =>
        service.priceCents == null
          ? servicePriceTypeLabels[service.priceType]
          : format(service.priceCents),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (service) => (
        <Badge variant={service.isActive ? 'default' : 'secondary'}>
          {service.isActive ? 'Active' : 'Archived'}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <title>Services | Borradh</title>

      <ListPage<ListedService>
        config={{
          title: 'Services',
          columns,
          rows: filteredServices,
          rowKey: (service) => service.id,
          onRowClick: openEdit,
          rowActions: (service) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={`Actions for ${service.name}`}
                  size="icon"
                  variant="ghost"
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(service)}>
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleArchive(service)}>
                  {service.isActive ? 'Archive' : 'Restore'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDelete(service)}
                  variant="destructive"
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          searchPlaceholder: 'Search services',
          search,
          onSearchChange: setSearch,
          primaryAction: {
            label: 'Add Service',
            mobileLabel: 'Add',
            onClick: () => openAdd(),
            // The caret is always there now: importing a price list works for
            // every org. Only the cross-location item is conditional, because
            // a single-location org would get an entry that can never do
            // anything.
            menu: {
              items: [
                { label: 'New service', onSelect: () => openAdd() },
                {
                  label: 'Import from a file…',
                  onSelect: () => setImportCsvOpen(true),
                },
                ...(isMultiLocation
                  ? [
                      {
                        label: 'Import from another location…',
                        onSelect: () => setImportOpen(true),
                      },
                    ]
                  : []),
              ],
            },
          },
          toolbar: (
            <Button
              className="gap-1.5"
              disabled={!activeOrg?.slug}
              onClick={handleCopyBookingLink}
              size="sm"
              variant="outline"
            >
              <Link2Icon className="size-4" />
              <span className="hidden sm:inline">Copy Booking Link</span>
            </Button>
          ),
          isLoading,
          isError,
          errorMessage: error?.message ?? 'Failed to load services',
          empty: {
            icon: Sparkles,
            title: search ? 'No matching services' : 'No services yet',
            description: search
              ? 'No service matches that search.'
              : 'Add your first service to start taking bookings.',
          },
        }}
      />

      <ImportServicesCsvDialog
        onOpenChange={setImportCsvOpen}
        open={importCsvOpen}
      />

      <ImportServicesDialog onOpenChange={setImportOpen} open={importOpen} />

      <ConfirmDeleteDialog
        // The consequence differs by SCOPE, so the description has to as well:
        // on a shared service the destructive button reaches every branch, and
        // saying "from your catalog" would understate it.
        description={
          sharedAcrossBranches
            ? `“${deleteTarget?.name}” is offered at other locations too. Removing it here leaves it in place for them; deleting removes it from every location's booking page. Appointments already booked are not affected either way.`
            : 'This permanently removes the service from your catalog and from your public booking page. Appointments already booked against it are not affected.'
        }
        confirmLabel={sharedAcrossBranches ? 'Delete everywhere' : 'Delete'}
        isPending={isRemoving}
        onConfirm={() => {
          if (deleteTarget) deleteService(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={!!deleteTarget}
        secondaryAction={
          sharedAcrossBranches && activeLocation
            ? {
                label: `Remove from ${branchLabel}`,
                onClick: async () => {
                  if (!deleteTarget) return;
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  await removeServiceLocationAsync({
                    serviceId: target.id,
                    locationId: activeLocation.id,
                  }).catch(() => {
                    // The hook already surfaced the server's message — including
                    // the "last location" refusal, which is the one an operator
                    // needs to read.
                  });
                },
              }
            : undefined
        }
        title={`Delete "${deleteTarget?.name}"?`}
      />
    </>
  );
}
