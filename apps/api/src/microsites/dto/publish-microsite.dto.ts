import { publishMicrositeSchema } from '@borradh-workspace/features/microsites';
import { createZodDto } from 'nestjs-zod';

/**
 * `createdBy` is omitted as well as the ids: a publish through this endpoint is
 * always a person pressing the button, and letting the body claim `system`
 * would put a false author on the revision history.
 */
export class PublishMicrositeDto extends createZodDto(
  publishMicrositeSchema.omit({
    micrositeId: true,
    organizationId: true,
    createdBy: true,
  })
) {}
