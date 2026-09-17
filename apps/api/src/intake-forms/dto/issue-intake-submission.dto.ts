import { issueIntakeSubmissionSchema } from '@borradh-workspace/features/intake-forms';
import { createZodDto } from 'nestjs-zod';

// organizationId comes from @ActiveOrganization.
export class IssueIntakeSubmissionDto extends createZodDto(
  issueIntakeSubmissionSchema.omit({ organizationId: true })
) {}
