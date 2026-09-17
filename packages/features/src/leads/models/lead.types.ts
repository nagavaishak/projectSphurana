import type { LeadStatus } from '@borradh-workspace/labels';
import type { ExtractData } from '../../shared/index.js';
// Types inferred from service return values
import type { createLead } from '../services/create-lead/index.js';
import type { updateLead } from '../services/update-lead/index.js';

/**
 * Lead type - inferred from createLead return
 */
export type Lead = ExtractData<Awaited<ReturnType<typeof createLead>>>;

/**
 * Updated lead type - inferred from updateLead return
 */
export type UpdatedLead = ExtractData<Awaited<ReturnType<typeof updateLead>>>;

/**
 * A lead as the LIST returns it: the row plus its derived pipeline `stage`.
 *
 * `stage` is not a column. It is computed per row from the conversion memo, the
 * linked conversation's messages and the explicit `lost` mark — see
 * `services/lead-stage/derived-stage.ts` — which is why it lives on the list
 * type rather than on `Lead` itself.
 */
export type LeadListItem = Lead & { stage: LeadStatus };
