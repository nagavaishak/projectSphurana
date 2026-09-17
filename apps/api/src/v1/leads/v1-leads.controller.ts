import { db } from '@borradh-workspace/database';
import {
  createLead,
  deleteLead,
  getLead,
  getLeadStats,
  listLeadHistory,
  listLeads,
  updateLead,
} from '@borradh-workspace/features/leads';
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
import { CreateLeadDto } from '../../leads/dto/create-lead.dto';
import { ListLeadHistoryDto } from '../../leads/dto/list-lead-history.dto';
import { ListLeadsDto } from '../../leads/dto/list-leads.dto';
import { UpdateLeadDto } from '../../leads/dto/update-lead.dto';
import { mapError } from '../shared/map-error';

@Controller('v1/leads')
@UseGuards(ApiKeyGuard, PlanAccessGuard, ScopeGuard)
export class V1LeadsController {
  @Get()
  @RequireScopes('leads:read')
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ApiKeyOrganization('id') organizationId: string,
    @Query() dto: ListLeadsDto
  ) {
    const result = await listLeads(db, {
      ...dto,
      organizationId,
      limit: dto.limit ?? 50,
      offset: dto.offset ?? 0,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get('stats')
  @RequireScopes('leads:read')
  async getStats(@ApiKeyOrganization('id') organizationId: string) {
    const result = await getLeadStats(db, { organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get(':id/history')
  @RequireScopes('leads:read')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getHistory(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') leadId: string,
    @Query() dto: ListLeadHistoryDto
  ) {
    const result = await listLeadHistory(db, {
      leadId,
      organizationId,
      limit: dto.limit ?? 50,
      offset: dto.offset ?? 0,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get(':id')
  @RequireScopes('leads:read')
  async findOne(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await getLead(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Post()
  @RequireScopes('leads:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ApiKeyOrganization('id') organizationId: string,
    @Body() dto: CreateLeadDto
  ) {
    const result = await createLead(db, { ...dto, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Put(':id')
  @RequireScopes('leads:write')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLeadDto
  ) {
    const result = await updateLead(db, { id, organizationId, ...dto });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  @RequireScopes('leads:write')
  async remove(
    @ApiKeyOrganization('id') organizationId: string,
    @Param('id') id: string
  ) {
    const result = await deleteLead(db, { id, organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }
}
