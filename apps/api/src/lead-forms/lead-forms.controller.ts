import { db } from '@borradh-workspace/database';
import {
  createLeadForm,
  deleteLeadForm,
  getLeadForm,
  listLeadForms,
  syncLeadFormToMeta,
  updateLeadForm,
} from '@borradh-workspace/features/lead-forms';
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
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common/index.js';
import { CreateLeadFormDto } from './dto/create-lead-form.dto.js';
import { ListLeadFormsDto } from './dto/list-lead-forms.dto.js';
import { SyncLeadFormDto } from './dto/sync-lead-form.dto.js';
import { UpdateLeadFormDto } from './dto/update-lead-form.dto.js';

@Controller('lead-forms')
@UseGuards(AuthGuard)
export class LeadFormsController {
  private readonly logger = new Logger(LeadFormsController.name);

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
  async create(
    @ActiveOrganization() orgId: string | undefined,
    @CurrentUser('id') userId: string,
    @Body() createLeadFormDto: CreateLeadFormDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `Create lead form request for organization: ${organizationId}`
    );

    const result = await createLeadForm(db, {
      ...createLeadFormDto,
      organizationId,
      createdById: userId,
    });

    if (!result.success) {
      const { code, message } = result.error;
      this.logger.warn(`Create lead form failed: ${code} - ${message}`);
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead form created successfully: ${result.data.id}`);
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(
    @ActiveOrganization() orgId: string | undefined,
    @Query() listLeadFormsDto: ListLeadFormsDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(
      `List lead forms request for organization: ${organizationId}`
    );

    const result = await listLeadForms(db, {
      organizationId,
      limit: listLeadFormsDto.limit ?? 20,
      offset: listLeadFormsDto.offset ?? 0,
      status: listLeadFormsDto.status,
    });

    if (!result.success) {
      this.logger.warn(
        `List lead forms failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get(':id')
  async findOne(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Get lead form request for ID: ${id}`);

    const result = await getLeadForm(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get lead form failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Put(':id')
  async update(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() updateLeadFormDto: UpdateLeadFormDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Update lead form request for ID: ${id}`);

    const result = await updateLeadForm(db, {
      id,
      organizationId,
      ...updateLeadFormDto,
    });

    if (!result.success) {
      this.logger.warn(
        `Update lead form failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead form updated successfully: ${id}`);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Delete lead form request for ID: ${id}`);

    const result = await deleteLeadForm(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Delete lead form failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead form deleted successfully: ${id}`);
    return result.data;
  }

  /**
   * Push a lead form to Meta. `organizationId` scopes the service's form
   * lookup, so an out-of-org id is NOT_FOUND (404) and nothing reaches Meta.
   */
  @Post(':id/sync')
  async sync(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() syncLeadFormDto: SyncLeadFormDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    this.logger.log(`Sync lead form request for ID: ${id}`);

    const result = await syncLeadFormToMeta(db, {
      leadFormId: id,
      organizationId,
      metaPageId: syncLeadFormDto.metaPageId,
    });

    if (!result.success) {
      const { code, message } = result.error;
      this.logger.warn(`Sync lead form failed: ${code} - ${message}`);
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Lead form synced successfully: ${id}`);
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
      default:
        return new HttpException(
          error.message || 'Internal server error',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
