import { db } from '@borradh-workspace/database';
import {
  createAppointment,
  deleteAppointment,
  getAppointment,
  listAppointments,
  updateAppointment,
} from '@borradh-workspace/features/appointments';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CreateAppointmentDto } from '../../appointments/dto/create-appointment.dto';
import { ListAppointmentsDto } from '../../appointments/dto/list-appointments.dto';
import { UpdateAppointmentDto } from '../../appointments/dto/update-appointment.dto';
import {
  ApiKeyGuard,
  ApiKeyOrganization,
  PlanAccessGuard,
  RequireScopes,
  ScopeGuard,
} from '../../common';
import { mapError } from '../shared/map-error';

@Controller('v1/appointments')
@UseGuards(ApiKeyGuard, PlanAccessGuard, ScopeGuard)
export class V1AppointmentsController {
  @Get()
  @RequireScopes('appointments:read')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ApiKeyOrganization('id') organizationId: string,
    @Query() dto: ListAppointmentsDto
  ) {
    const result = await listAppointments(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get(':id')
  @RequireScopes('appointments:read')
  async findOne(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getAppointment(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Post()
  @RequireScopes('appointments:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ApiKeyOrganization('id') organizationId: string,
    @Body() dto: CreateAppointmentDto
  ) {
    const result = await createAppointment(db, {
      ...dto,
      organizationId,
      assignedToId: dto.assignedToId ?? 'api-key', // Default when no user context
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireScopes('appointments:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto
  ) {
    const result = await updateAppointment(db, {
      id,
      organizationId,
      ...dto,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireScopes('appointments:write')
  async remove(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteAppointment(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }
}
