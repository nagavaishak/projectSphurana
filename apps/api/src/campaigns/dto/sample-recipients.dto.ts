import { listSampleRecipientsSchema } from '@borradh-workspace/features/campaigns';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST campaigns/segments/sample-recipients` — drives the composer's
 * mail-merge preview. `organizationId` is injected from the active-org session,
 * never sent by the client.
 */
export class SampleRecipientsDto extends createZodDto(
  listSampleRecipientsSchema.omit({ organizationId: true })
) {}
