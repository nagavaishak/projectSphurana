import type { ExtractData } from '../../shared/index.js';
// Types inferred from service return values
import type { createUser } from '../services/create-user/index.js';
import type { updateUser } from '../services/update-user/index.js';

/**
 * User type - inferred from createUser return
 */
export type User = ExtractData<Awaited<ReturnType<typeof createUser>>>;

/**
 * Updated user type - inferred from updateUser return
 */
export type UpdatedUser = ExtractData<Awaited<ReturnType<typeof updateUser>>>;
