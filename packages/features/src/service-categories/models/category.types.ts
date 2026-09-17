export type {
  OrganizationServiceCategory,
  NewOrganizationServiceCategory,
} from '@borradh-workspace/database';

export const ServiceCategoryErrorCodes = {
  CATEGORY_NOT_FOUND: 'SERVICE_CATEGORY_NOT_FOUND',
  CATEGORY_ALREADY_EXISTS: 'SERVICE_CATEGORY_ALREADY_EXISTS',
  CATEGORY_IN_USE: 'SERVICE_CATEGORY_IN_USE',
} as const;

export type ServiceCategoryErrorCode =
  (typeof ServiceCategoryErrorCodes)[keyof typeof ServiceCategoryErrorCodes];
