// Organization Locations feature barrel export

// Services
export {
  // create-location
  createLocation,
  createLocationSchema,
  type CreateLocationInput,
  type CreateLocationResult,
  // list-locations
  listLocations,
  listLocationsSchema,
  type ListLocationsInput,
  type ListLocationsResult,
  // update-location
  updateLocation,
  updateLocationSchema,
  type UpdateLocationInput,
  type UpdateLocationResult,
  // delete-location
  deleteLocation,
  deleteLocationSchema,
  type DeleteLocationInput,
  type DeleteLocationResult,
  // set-primary-location
  setPrimaryLocation,
  setPrimaryLocationSchema,
  type SetPrimaryLocationInput,
  type SetPrimaryLocationResult,
  // resolve-active-location
  resolveActiveLocation,
  resolveActiveLocationSchema,
  type ResolveActiveLocationInput,
  type ResolvedActiveLocation,
  type ResolveActiveLocationResult,
  // resolve-default-location
  resolveDefaultLocation,
  type DefaultLocation,
  // resolve-booking-location
  resolveBookingLocation,
  getBookingLocationById,
  formatBookingLocationAddress,
  bookingLocationAddressLines,
  isBookingLocationAddressable,
  type BookingLocation,
  // assert-locations-belong-to-org
  assertLocationsBelongToOrg,
  // apply-location-catalog
  applyLocationCatalog,
  applyLocationCatalogImpl,
  applyLocationCatalogSchema,
  type ApplyLocationCatalogInput,
  type ApplyLocationCatalogResult,
  type LocationCatalogCounts,
  // get-location-catalog
  getLocationCatalog,
  getLocationCatalogSchema,
  type GetLocationCatalogInput,
  type GetLocationCatalogResult,
  type LocationCatalog,
} from './services/index.js';
