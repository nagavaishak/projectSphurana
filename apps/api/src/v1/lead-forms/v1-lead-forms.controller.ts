import { db } from '@borradh-workspace/database';
import {
  createLeadForm,
  deleteLeadForm,
  getLeadForm,
  listLeadForms,
  updateLeadForm,
} from '@borradh-workspace/features/lead-forms';
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
import {
  ApiKeyGuard,
  ApiKeyOrganization,
  PlanAccessGuard,
  RequireScopes,
  ScopeGuard,
} from '../../common';
import { CreateLeadFormDto } from '../../lead-forms/dto/create-lead-form.dto.js';
import { ListLeadFormsDto } from '../../lead-forms/dto/list-lead-forms.dto.js';
import { UpdateLeadFormDto } from '../../lead-forms/dto/update-lead-form.dto.js';
import { mapError } from '../shared/map-error';

@Controller('v1/lead-forms')
@UseGuards(ApiKeyGuard, PlanAccessGuard, ScopeGuard)
export class V1LeadFormsController {
  @Get()
  @RequireScopes('lead-forms:read')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ApiKeyOrganization('id') organizationId: string,
    @Query() dto: ListLeadFormsDto
  ) {
    const result = await listLeadForms(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get(':id')
  @RequireScopes('lead-forms:read')
  async findOne(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getLeadForm(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Post()
  @RequireScopes('lead-forms:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ApiKeyOrganization('id') organizationId: string,
    @Body() dto: CreateLeadFormDto
  ) {
    const result = await createLeadForm(db, {
      ...dto,
      organizationId,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireScopes('lead-forms:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadFormDto
  ) {
    const result = await updateLeadForm(db, {
      id,
      organizationId,
      ...dto,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireScopes('lead-forms:write')
  async remove(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteLeadForm(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }
}
