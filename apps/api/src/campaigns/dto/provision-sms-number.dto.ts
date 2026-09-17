import { provisionSmsNumberSchema } from '@borradh-workspace/features/campaigns';
import { createZodDto } from 'nestjs-zod';

// organizationId + smsWebhookUrl are set server-side, not by the client.
export class ProvisionSmsNumberDto extends createZodDto(
  provisionSmsNumberSchema.omit({ organizationId: true, smsWebhookUrl: true })
) {}
