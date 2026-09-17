import {
  appointmentWithRelationsSchema,
  listAppointmentsResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  createAppointment,
  deleteAppointment,
  getAppointment,
  listAppointmentsForMember,
  updateAppointment,
} from '@borradh-workspace/features/appointments';
import { checkAvailability } from '@borradh-workspace/features/calendar';
import { reassignAppointmentResource } from '@borradh-workspace/features/resources';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  ResponseContract,
} from '../common';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { FindOpenSlotsDto } from './dto/find-open-slots.dto';
import { ListAppointmentsDto } from './dto/list-appointments.dto';
// VALUE import, not `import type` — nestjs-zod reads the DTO class off
// `design:paramtypes`, which a type-only import erases. See the note in
// resources.controller.ts; getting this wrong silently disables validation.
import { ReassignAppointmentResourceDto } from './dto/reassign-appointment-resource.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';

@Controller('appointments')
@UseGuards(AuthGuard)
export class AppointmentsController {
  private readonly logger = new Logger(AppointmentsController.name);

  private requireActiveOrganization(
    organizationId: string | undefined
  ): string {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return organizationId;
  }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Body() createAppointmentDto: CreateAppointmentDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Create appointment request for organization: ${organizationId}`
    );

    const result = await createAppointment(db, {
      ...createAppointmentDto,
      organizationId,
      locationId,
      assignedToId: createAppointmentDto.assignedToId ?? userId,
    });

    if (!result.success) {
      throw this.handleError('Create appointment', result.error);
    }

    this.logger.log(`Appointment created successfully: ${result.data.id}`);
    return result.data;
  }

  @Post('open-slots')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findOpenSlots(
    @ActiveOrganization() orgId: string | undefined,
    @Body() findOpenSlotsDto: FindOpenSlotsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Find open slots request for organization: ${organizationId} on ${findOpenSlotsDto.date}`
    );

    const result = await checkAvailability(db, {
      ...findOpenSlotsDto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Find open slots failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @ResponseContract(listAppointmentsResponseSchema)
  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @ActiveLocation() locationId: string | undefined,
    @CurrentUser('id') userId: string,
    @Query() listAppointmentsDto: ListAppointmentsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `List appointments request for organization: ${organizationId}`
    );

    const result = await listAppointmentsForMember(db, {
      ...listAppointmentsDto,
      organizationId,
      locationId,
      userId,
    });

    if (!result.success) {
      throw this.handleError('List appointments', result.error);
    }

    return result.data;
  }

  @ResponseContract(appointmentWithRelationsSchema)
  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Get appointment request for ID: ${id}`);

    const result = await getAppointment(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get appointment failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Update appointment request for ID: ${id}`);

    const result = await updateAppointment(db, {
      id,
      organizationId,
      ...updateAppointmentDto,
    });

    if (!result.success) {
      this.logger.warn(
        `Update appointment failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Appointment updated successfully: ${id}`);
    return result.data;
  }

  /**
   * Move ONE of this appointment's held resources to another in the same
   * category — drag-to-reassign on the rooms calendar, and the override
   * popover on the booking dialog / side panel.
   *
   * Changes only WHICH resource is held, never the time. A 409 here is an
   * expected outcome (the target is busy), which the client turns into a
   * "Force" prompt rather than a generic error.
   */
  @Put(':id/resources')
  async reassignResource(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() dto: ReassignAppointmentResourceDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);

    const result = await reassignAppointmentResource(db, {
      organizationId,
      appointmentId: id,
      ...dto,
    });

    if (!result.success) {
      this.logger.warn(
        `Reassign resource failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Delete appointment request for ID: ${id}`);

    const result = await deleteAppointment(db, {
      id,
      organizationId,
      actorId: userId,
    });

    if (!result.success) {
      this.logger.warn(
        `Delete appointment failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Appointment deleted successfully: ${id}`);
    return result.data;
  }

  /** Log a failed use case, then hand back the exception for the caller to throw. */
  private handleError(
    label: string,
    error: { code: string; message: string; details?: Record<string, unknown> }
  ) {
    this.logger.warn(`${label} failed: ${error.code} - ${error.message}`);
    return this.mapErrorToHttpException(error);
  }

  private mapErrorToHttpException(error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  }) {
    switch (error.code) {
      case ErrorCodes.VALIDATION_ERROR:
      case ErrorCodes.INVALID_INPUT:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.UNAUTHORIZED:
        return new HttpException(error.message, HttpStatus.UNAUTHORIZED);
      case ErrorCodes.FORBIDDEN:
        return new HttpException(error.message, HttpStatus.FORBIDDEN);
      case ErrorCodes.NOT_FOUND:
        return new HttpException(error.message, HttpStatus.NOT_FOUND);
      case ErrorCodes.ALREADY_EXISTS:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case ErrorCodes.CONFLICT:
        // Structured body, not a bare string: a double-booking conflict is
        // RECOVERABLE — the calendar offers "Book anyway" — and the client has
        // to be able to tell it apart from the other 409s (already exists, the
        // practitioner is outside their availability), which are not. The
        // service puts `conflictingAppointmentId` in `details`; the api-client
        // lifts `message` / `code` / `details` off the body verbatim.
        return new HttpException(
          {
            message: error.message,
            code: error.code,
            details: error.details,
          },
          HttpStatus.CONFLICT
        );
      case ErrorCodes.INVALID_STATE:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
