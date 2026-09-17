import {
  leadDetailSchema,
  leadHistoryResponseSchema,
  leadStatsSchema,
  listLeadsResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  createNormalizedLead,
  deleteLead,
  exportLeadsToCsv,
  getLead,
  getLeadProfile,
  getLeadStageCounts,
  getLeadStats,
  importLeads,
  importLeadsCsv,
  listLeadHistory,
  listLeads,
  summariseRecentLeads,
  updateLead,
} from '@borradh-workspace/features/leads';
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
  Patch,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ActiveLocation,
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  ResponseContract,
  RoleGuard,
} from '../common';
import { CreateLeadDto } from './dto/create-lead.dto';
import { ExportLeadsDto } from './dto/export-leads.dto';
import { ImportLeadsCsvDto } from './dto/import-leads-csv.dto';
import { ImportLeadsDto } from './dto/import-leads.dto';
import { ListLeadHistoryDto } from './dto/list-lead-history.dto';
import { ListLeadsDto } from './dto/list-leads.dto';
import { SummariseRecentLeadsDto } from './dto/summarise-recent-leads.dto';
import { UpdateLeadStatusDto } from './dto/update-lead-status.dto';
import { UpdateLeadDto } from './dto/update-lead.dto';

@Controller('leads')
@UseGuards(AuthGuard, RoleGuard)
export class LeadsController {
  private readonly logger = new Logger(LeadsController.name);

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async create(
    @ActiveOrganization() organizationId: string,
    @ActiveLocation() primaryLocationId: string | undefined,
    @Body() createLeadDto: CreateLeadDto
  ) {
    this.logger.log(`Create lead request for organization: ${organizationId}`);

    const result = await createNormalizedLead(db, {
      ...createLeadDto,
      organizationId,
      // "Home branch" — where this customer was captured. Not ownership; see
      // the note on `listLeads`'s `locationId`.
      primaryLocationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Create lead failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead created successfully: ${result.data.id}`);
    return result.data;
  }

  @Get()
  @ResponseContract(listLeadsResponseSchema)
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() organizationId: string,
    @ActiveLocation() locationId: string | undefined,
    @Query() listLeadsDto: ListLeadsDto
  ) {
    this.logger.log(`List leads request for organization: ${organizationId}`);

    const result = await listLeads(db, {
      ...listLeadsDto,
      organizationId,
      locationId,
      limit: listLeadsDto.limit ?? 50,
      offset: listLeadsDto.offset ?? 0,
    });

    if (!result.success) {
      this.logger.warn(
        `List leads failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Post('import-csv')
  // Parsing is deterministic now, but keep imports rare — each one can still
  // make one AI column-mapping call and bulk-insert thousands of rows.
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @UsePipes(new ValidationPipe({ transform: true }))
  async importLeadsFromCsv(
    @ActiveOrganization() organizationId: string,
    @Body() importLeadsCsvDto: ImportLeadsCsvDto
  ) {
    const result = await importLeadsCsv(db, {
      ...importLeadsCsvDto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `CSV import failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `CSV import complete: ${result.data.imported} imported from ${result.data.rowsInFile} rows`
    );
    return result.data;
  }

  @Post('import')
  @UsePipes(new ValidationPipe({ transform: true }))
  async importLeadsBatch(
    @ActiveOrganization() organizationId: string,
    @Body() importLeadsDto: ImportLeadsDto
  ) {
    this.logger.log(
      `Import leads request for organization: ${organizationId} (${importLeadsDto.leads.length} leads)`
    );

    const result = await importLeads(db, {
      ...importLeadsDto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Import leads failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(
      `Import complete: ${result.data.imported} imported, ${result.data.skipped} skipped, ${result.data.updated} updated, ${result.data.errors.length} errors`
    );
    return result.data;
  }

  @Get('export')
  @UsePipes(new ValidationPipe({ transform: true }))
  async exportLeadsCsv(
    @ActiveOrganization() organizationId: string,
    @Query() exportLeadsDto: ExportLeadsDto,
    @Res() res: Response
  ) {
    this.logger.log(`Export leads request for organization: ${organizationId}`);

    const result = await exportLeadsToCsv(db, {
      ...exportLeadsDto,
      organizationId,
    });
    if (!result.success) {
      const { code, message } = result.error;
      this.logger.warn(`Export leads failed: ${code} - ${message}`);
      throw this.mapErrorToHttpException(result.error);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.data.filename}"`
    );
    res.send(result.data.csv);
  }

  @Get('stats')
  @ResponseContract(leadStatsSchema)
  async getStats(@ActiveOrganization() organizationId: string) {
    this.logger.log(
      `Get lead stats request for organization: ${organizationId}`
    );

    const result = await getLeadStats(db, { organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get lead stats failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('stage-counts')
  // role-guard-exempt: org-scoped read of the caller's own leads, same audience
  // as GET /leads and GET /leads/stats (both baselined unguarded on this
  // controller). Returns only aggregate counts for the active org.
  async getStageCounts(
    @ActiveOrganization() organizationId: string,
    // Same branch the list takes (`findAll` above). Without it the tab badges
    // counted the whole org while the rows beneath them counted one branch.
    @ActiveLocation() locationId: string | undefined
  ) {
    this.logger.log(
      `Get lead stage counts request for organization: ${organizationId}`
    );

    const result = await getLeadStageCounts(db, { organizationId, locationId });

    if (!result.success) {
      this.logger.warn(
        `Get lead stage counts failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('summary')
  @UsePipes(new ValidationPipe({ transform: true }))
  async getSummary(
    @ActiveOrganization() organizationId: string,
    @Query() query: SummariseRecentLeadsDto
  ) {
    this.logger.log(
      `Summarise recent leads request for organization: ${organizationId} (timeframe: ${query.timeframe})`
    );

    const result = await summariseRecentLeads(db, {
      organizationId,
      timeframe: query.timeframe,
      limit: query.limit,
    });

    if (!result.success) {
      this.logger.warn(
        `Summarise recent leads failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/history')
  @ResponseContract(leadHistoryResponseSchema)
  @UsePipes(new ValidationPipe({ transform: true }))
  async getHistory(
    @ActiveOrganization() organizationId: string,
    @Param('id') leadId: string,
    @Query() listLeadHistoryDto: ListLeadHistoryDto
  ) {
    this.logger.log(`Get lead history request for ID: ${leadId}`);

    const result = await listLeadHistory(db, {
      leadId,
      organizationId,
      limit: listLeadHistoryDto.limit ?? 50,
      offset: listLeadHistoryDto.offset ?? 0,
    });

    if (!result.success) {
      this.logger.warn(
        `Get lead history failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id/profile')
  async getProfile(
    @ActiveOrganization() organizationId: string,
    @Param('id') leadId: string
  ) {
    this.logger.log(`Get lead profile request for ID: ${leadId}`);

    const result = await getLeadProfile(db, { organizationId, leadId });

    if (!result.success) {
      this.logger.warn(
        `Get lead profile failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id')
  @ResponseContract(leadDetailSchema)
  async findOne(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string
  ) {
    this.logger.log(`Get lead request for ID: ${id}`);

    const result = await getLead(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get lead failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @Body() updateLeadDto: UpdateLeadDto
  ) {
    this.logger.log(`Update lead request for ID: ${id}`);

    const result = await updateLead(db, {
      id,
      organizationId,
      ...updateLeadDto,
    });

    if (!result.success) {
      this.logger.warn(
        `Update lead failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead updated successfully: ${id}`);
    return result.data;
  }

  @Patch(':id/status')
  @UsePipes(new ValidationPipe({ transform: true }))
  async updateStatus(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @Body() body: UpdateLeadStatusDto
  ) {
    this.logger.log(`Update lead status request for ID: ${id}`);

    const result = await updateLead(db, {
      id,
      organizationId,
      status: body.status,
    });

    if (!result.success) {
      this.logger.warn(
        `Update lead status failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead status updated successfully: ${id}`);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() organizationId: string,
    @Param('id') id: string,
    @CurrentUser('id') userId: string
  ) {
    this.logger.log(`Delete lead request for ID: ${id}`);

    const result = await deleteLead(db, {
      id,
      organizationId,
      actorId: userId,
    });

    if (!result.success) {
      this.logger.warn(
        `Delete lead failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead deleted successfully: ${id}`);
    return result.data;
  }

  private mapErrorToHttpException(error: { code: string; message: string }) {
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
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
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
