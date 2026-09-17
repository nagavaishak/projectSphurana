import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type {
  PatientPrincipal,
  PatientRequest,
} from '../guards/patient-auth.guard.js';

/**
 * CurrentPatient Decorator — extracts the signed-in patient principal that
 * `PatientAuthGuard` attached to the request.
 *
 * Usage:
 * ```typescript
 * @UseGuards(PatientAuthGuard)
 * @Get('me')
 * me(@CurrentPatient() patient: PatientPrincipal) {
 *   return patient.leadId;
 * }
 *
 * // Or a single property
 * @Get('me')
 * me(@CurrentPatient('leadId') leadId: string) {}
 * ```
 */
export const CurrentPatient = createParamDecorator(
  (data: keyof PatientPrincipal | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<PatientRequest>();
    const patient = request.patient;

    if (data) {
      return patient?.[data];
    }
    return patient;
  }
);
