import { setShiftOverrideRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** Body for PUT /shifts/override/:practitionerId (practitionerId is a route param). */
export class SetShiftOverrideDto extends createZodDto(
  setShiftOverrideRequestSchema
) {}
