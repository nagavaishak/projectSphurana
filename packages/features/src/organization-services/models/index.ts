// Re-export database types for convenience
export type {
  OrganizationService,
  NewOrganizationService,
  ServiceCategory,
} from '@borradh-workspace/database';

// Custom error codes for organization services
export const OrganizationServiceErrorCodes = {
  SERVICE_NOT_FOUND: 'ORGANIZATION_SERVICE_NOT_FOUND',
  SERVICE_ALREADY_EXISTS: 'SERVICE_ALREADY_EXISTS',
  CANNOT_DELETE_LINKED_SERVICE: 'CANNOT_DELETE_LINKED_SERVICE',
} as const;

export type OrganizationServiceErrorCode =
  (typeof OrganizationServiceErrorCodes)[keyof typeof OrganizationServiceErrorCodes];
