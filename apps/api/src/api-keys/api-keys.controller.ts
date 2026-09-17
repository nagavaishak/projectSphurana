import { auth } from '@borradh-workspace/auth/server';
import { db } from '@borradh-workspace/database';
import {
  listApiKeys,
  prepareApiKeyCreation,
  revokeApiKey,
  updateApiKey,
} from '@borradh-workspace/features/api-keys';
import { createApiKey } from '@borradh-workspace/features/auth';
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
  UseGuards,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  CurrentUser,
  SkipPaidPlanCheck,
} from '../common';
import { CreateApiKeyDto } from './dto/create-api-key.dto.js';
import { UpdateApiKeyDto } from './dto/update-api-key.dto.js';

@Controller('api-keys')
@UseGuards(AuthGuard)
@SkipPaidPlanCheck()
export class ApiKeysController {
  private readonly logger = new Logger(ApiKeysController.name);

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
    @Body() dto: CreateApiKeyDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const prep = await prepareApiKeyCreation(db, { organizationId });
    if (!prep.success) throw this.mapError(prep.error);

    const result = await createApiKey(auth.api, {
      userId,
      organizationId,
      ...prep.data,
      name: dto.name,
      expiresInDays: dto.expiresInDays,
      scopes: dto.scopes,
    });
    if (!result.success) {
      throw this.handleError('Create API key', result.error);
    }

    this.logger.log(`API key created: ${result.data.id}`);
    return result.data;
  }

  @Get()
  async findAll(@ActiveOrganization() orgId: string | undefined) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await listApiKeys(db, { organizationId });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Patch(':id')
  async update(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateApiKeyDto
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await updateApiKey(db, {
      keyId: id,
      organizationId,
      ...dto,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @ActiveOrganization() orgId: string | undefined,
    @Param('id') id: string
  ) {
    const organizationId = this.requireActiveOrganization(orgId);
    const result = await revokeApiKey(db, {
      keyId: id,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** Log a failed use case, then hand back the exception for the caller to throw. */
  private handleError(label: string, error: { code: string; message: string }) {
    this.logger.warn(`${label} failed: ${error.code} - ${error.message}`);
    return this.mapError(error);
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
      [ErrorCodes.UNAUTHORIZED]: HttpStatus.UNAUTHORIZED,
      [ErrorCodes.FORBIDDEN]: HttpStatus.FORBIDDEN,
      [ErrorCodes.NOT_FOUND]: HttpStatus.NOT_FOUND,
      [ErrorCodes.ALREADY_EXISTS]: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
