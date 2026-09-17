import { MobilePageShell } from '@/components/app/mobile-page-shell';
import { useListOffers } from '@/features/offers';
import { useActiveLocation } from '@/features/organization-locations';
import {
  useDeleteService,
  useListServices,
  useUpdateService,
} from '@/features/organization-services';
import type { OrganizationService } from '@/features/organization-services';
import { useListPractitioners } from '@/features/practitioners';
import { useListCategories } from '@/features/service-categories';
import { ROUTES } from '@/lib/route-paths';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ImportServicesCsvDialog } from '../import-services-csv-dialog';
import { ImportServicesDialog } from '../import-services-dialog';

import { ServicesMobileFilters } from './services-mobile-filters';
import { ServicesMobileList } from './services-mobile-list';
import {
  ALL_CATEGORIES,
  ALL_STAFF,
  type CategoryFilterValue,
  type StaffFilterValue,
  buildOffersByServiceId,
  buildPractitionersByService,
  filterServices,
  getCategoryFilterOptions,
  getStaffFilterOptions,
  groupServicesForMobileList,
} from './services-mobile-utils';

export function ServicesMobilePage() {
  const navigate = useNavigate();
  const handleBack = useCallback(() => {
    void navigate({ to: ROUTES.dashboardAccount });
  }, [navigate]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] =
    useState<CategoryFilterValue>(ALL_CATEGORIES);
  const [staffFilter, setStaffFilter] = useState<StaffFilterValue>(ALL_STAFF);
  // Active AND archived — see the note on the desktop page. Mobile has the
  // same import entry point in its `+` menu, so importing "as archived" here
  // hid the rows just as thoroughly. Archived rows are badged and dimmed in
  // `ServicesMobileList`, so they can never be mistaken for bookable ones.
  const { services, isLoading, isError, error } = useListServices({
    limit: 100,
    isActive: undefined,
  });
  const { offers } = useListOffers({ limit: 100 });
  const { categories } = useListCategories();
  const { practitioners } = useListPractitioners({ params: { limit: 100 } });
  const { deleteService } = useDeleteService();
  const { updateService } = useUpdateService({ showSuccessToast: false });

  const practitionersByService = useMemo(
    () => buildPractitionersByService(practitioners),
    [practitioners]
  );
  const offersByServiceId = useMemo(
    () => buildOffersByServiceId(offers),
    [offers]
  );

  const categoryOptions = useMemo(
    () => getCategoryFilterOptions(services, categories),
    [services, categories]
  );
  const staffOptions = useMemo(
    () => getStaffFilterOptions(practitioners),
    [practitioners]
  );

  const filteredServices = useMemo(
    () =>
      filterServices({
        services,
        search,
        categoryFilter,
        staffFilter,
        practitionersByService,
      }),
    [services, search, categoryFilter, staffFilter, practitionersByService]
  );

  const groups = useMemo(
    () =>
      groupServicesForMobileList({
        services: filteredServices,
        offersByServiceId,
        categories,
      }),
    [filteredServices, offersByServiceId, categories]
  );

  const { isMultiLocation } = useActiveLocation();
  const [importOpen, setImportOpen] = useState(false);
  const [importCsvOpen, setImportCsvOpen] = useState(false);

  const openAddService = () => {
    void navigate({ to: '/create/$entity', params: { entity: 'service' } });
  };

  const openEditService = (service: OrganizationService) => {
    void navigate({
      to: '/edit/$entity/$id',
      params: { entity: 'service', id: service.id },
    });
  };

  const toggleArchive = (service: OrganizationService) => {
    const restoring = !service.isActive;
    updateService(
      { id: service.id, isActive: restoring },
      {
        onSuccess: () =>
          toast.success(restoring ? 'Service restored' : 'Service archived'),
      }
    );
  };

  return (
    <MobilePageShell
      onBack={handleBack}
      title="Services"
      toolbar={
        <ServicesMobileFilters
          categoryFilter={categoryFilter}
          categoryOptions={categoryOptions}
          onAddService={openAddService}
          onCategoryFilterChange={setCategoryFilter}
          onImportServices={
            isMultiLocation ? () => setImportOpen(true) : undefined
          }
          onImportServicesCsv={() => setImportCsvOpen(true)}
          onSearchChange={setSearch}
          onStaffFilterChange={setStaffFilter}
          search={search}
          staffFilter={staffFilter}
          staffOptions={staffOptions}
        />
      }
    >
      <ImportServicesCsvDialog
        onOpenChange={setImportCsvOpen}
        open={importCsvOpen}
      />

      <ImportServicesDialog onOpenChange={setImportOpen} open={importOpen} />

      <ServicesMobileList
        errorMessage={error?.message}
        groups={groups}
        isError={isError}
        isLoading={isLoading}
        onAddService={openAddService}
        onDeleteService={(id) => deleteService(id)}
        onEditService={openEditService}
        onToggleArchive={toggleArchive}
      />
    </MobilePageShell>
  );
}
