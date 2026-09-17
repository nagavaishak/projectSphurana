import { listAuditLogsSchema } from '@borradh-workspace/features/admin-terminal';
import { createZodDto } from 'nestjs-zod';

export class ListAuditLogsDto extends createZodDto(listAuditLogsSchema) {}
