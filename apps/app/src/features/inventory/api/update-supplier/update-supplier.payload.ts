import {
  type CreateSupplierBody,
  buildCreateSupplierPayload,
} from '../create-supplier/create-supplier.payload';
import type { UpdateSupplierIntent } from './update-supplier.input';

/** The update wire body is identical in shape to the create body. */
export type UpdateSupplierBody = CreateSupplierBody;

/** Assemble the supplier update wire body — the single build site. */
export function buildUpdateSupplierPayload(
  intent: UpdateSupplierIntent
): UpdateSupplierBody {
  return buildCreateSupplierPayload(intent);
}
