import { updateLeadRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /leads/:id` body. Validated against the CANONICAL wire contract, which
 * replaces the inline copy that used to live here. The features-package
 * `updateLeadSchema` is that same contract plus `id` and `organizationId`,
 * which the controller injects from the route param and the active-org session
 * — so there is no longer a second description of this body to drift.
 *
 * The enums still come from the labels vocabulary (via the contract), which is
 * what keeps `meta_lead_form` / `whatsapp` leads editable and `booked` / `cold`
 * settable.
 */
export class UpdateLeadDto extends createZodDto(updateLeadRequestSchema) {}
