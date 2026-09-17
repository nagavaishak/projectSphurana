import type { AppVersionCheck as BackendAppVersionCheck } from '@borradh-workspace/features/app-version';

/**
 * The check carries no Date fields, so the backend shape survives
 * serialization unchanged and can be re-exported as-is.
 */
export type AppVersionCheck = BackendAppVersionCheck;
