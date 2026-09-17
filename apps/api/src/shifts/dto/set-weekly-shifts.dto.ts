import { setWeeklyShiftsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** Body for PUT /shifts/weekly/:practitionerId (practitionerId is a route param). */
export class SetWeeklyShiftsDto extends createZodDto(
  setWeeklyShiftsRequestSchema
) {}
