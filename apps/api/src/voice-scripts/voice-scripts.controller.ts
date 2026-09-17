import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  createVoiceScript,
  deleteVoiceScript,
  getDefaultVoiceScript,
  getVoiceScript,
  listVoiceScripts,
  updateVoiceScript,
} from '@borradh-workspace/features/voice-scripts';
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
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard } from '../common/index.js';
import type {
  CreateVoiceScriptDto,
  ListVoiceScriptsDto,
  UpdateVoiceScriptDto,
} from './dto/index.js';

@Controller('voice-scripts')
@UseGuards(AuthGuard)
export class VoiceScriptsController {
  private readonly logger = new Logger(VoiceScriptsController.name);

  @Post()
  async create(
    @ActiveOrganization() organizationId: string,
    @Body() createVoiceScriptDto: CreateVoiceScriptDto
  ) {
    this.logger.log(
      `Create voice script request for organization: ${organizationId}`
    );

    const result = await createVoiceScript(db, {
      ...createVoiceScriptDto,
      organizationId,
    });

    if (!result.success) {
      this.logger.warn(
        `Create voice script failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Voice script created successfully: ${result.data.id}`);
    return result.data;
  }

  @Get()
  async findAll(
    @ActiveOrganization() organizationId: string,
    @Query() listVoiceScriptsDto: ListVoiceScriptsDto
  ) {
    this.logger.log(
      `List voice scripts request for organization: ${organizationId}`
    );

    const result = await listVoiceScripts(db, {
      ...listVoiceScriptsDto,
      organizationId,
      limit: listVoiceScriptsDto.limit ?? 20,
      offset: listVoiceScriptsDto.offset ?? 0,
    });

    if (!result.success) {
      this.logger.warn(
        `List voice scripts failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Get('default')
  async findDefault(@ActiveOrganization() organizationId: string) {
    this.logger.log(
      `Get default voice script request for organization: ${organizationId}`
    );

    const result = await getDefaultVoiceScript(db, { organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get default voice script failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    // Return null if no default script (not an error)
    return result.data;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    this.logger.log(`Get voice script request for ID: ${id}`);

    const result = await getVoiceScript(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Get voice script failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    return result.data;
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @Body() updateVoiceScriptDto: UpdateVoiceScriptDto
  ) {
    this.logger.log(`Update voice script request for ID: ${id}`);

    const result = await updateVoiceScript(db, {
      id,
      organizationId,
      ...updateVoiceScriptDto,
    });

    if (!result.success) {
      this.logger.warn(
        `Update voice script failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Voice script updated successfully: ${id}`);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    this.logger.log(`Delete voice script request for ID: ${id}`);

    const result = await deleteVoiceScript(db, { id, organizationId });

    if (!result.success) {
      this.logger.warn(
        `Delete voice script failed: ${result.error.code} - ${result.error.message}`
      );
      throw this.mapErrorToHttpException(result.error);
    }

    this.logger.log(`Voice script deleted successfully: ${id}`);
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
