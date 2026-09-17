import type { ExtractData } from '../../shared/index.js';
// Types inferred from service return values
import type { createSequence } from '../services/create-sequence/index.js';
import type { updateSequence } from '../services/update-sequence/index.js';

/**
 * Sequence type - inferred from createSequence return
 */
export type Sequence = ExtractData<Awaited<ReturnType<typeof createSequence>>>;

/**
 * Updated sequence type - inferred from updateSequence return
 */
export type UpdatedSequence = ExtractData<
  Awaited<ReturnType<typeof updateSequence>>
>;
