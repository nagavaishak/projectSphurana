export type {
  OrganizationPackage,
  NewOrganizationPackage,
  OrganizationPackageItem,
  NewOrganizationPackageItem,
} from '@borradh-workspace/database';

export const PackageErrorCodes = {
  PACKAGE_NOT_FOUND: 'PACKAGE_NOT_FOUND',
  PACKAGE_ALREADY_EXISTS: 'PACKAGE_ALREADY_EXISTS',
  PACKAGE_ITEM_NOT_FOUND: 'PACKAGE_ITEM_NOT_FOUND',
  PACKAGE_ITEM_DUPLICATE: 'PACKAGE_ITEM_DUPLICATE',
  VARIANT_WRONG_ORG: 'PACKAGE_VARIANT_WRONG_ORG',
} as const;

export type PackageErrorCode =
  (typeof PackageErrorCodes)[keyof typeof PackageErrorCodes];
