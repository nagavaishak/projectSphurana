import {
  graphicSchema,
  listGraphicsResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  createContentGraphic,
  reviseContent,
} from '@borradh-workspace/features/content-items';
import {
  confirmGraphicOutput,
  createGraphicOutputUploadUrl,
  deleteGraphic,
  getGraphic,
  listGraphicTemplates,
  listGraphics,
  updateGraphic,
} from '@borradh-workspace/features/graphics';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  getOrgAssetsBucket,
  getPresignedUploadUrl,
  getPrivateCdnUrl,
  isCdnEnabled,
} from '@borradh-workspace/storage';
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
  ActiveOrganization,
  AuthGuard,
  type AuthenticatedRequest,
  CurrentUser,
  ResponseContract,
  signGraphicOutputs,
} from '../common/index.js';
import type {
  ConfirmGraphicOutputDto,
  CreateGraphicOutputUploadUrlDto,
  GenerateGraphicFromServiceDto,
  ListGraphicsDto,
  RegenerateGraphicDto,
  UpdateGraphicDto,
} from './dto/index.js';

/**
 * Rendered outputs are re-signed to short-lived CloudFront URLs on read by
 * `signGraphicOutputs` — see `apps/api/src/common/media/cdn-signing.ts`, which
 * `ContentBatchesController` shares (the two controllers carried
 * character-identical private copies of it).
 */
@Controller('graphics')
@UseGuards(AuthGuard)
export class GraphicsController {
  private readonly logger = new Logger(GraphicsController.name);

  @ResponseContract(listGraphicsResponseSchema)
  // ==================== READS ====================

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @ActiveOrganization() organizationId: string | undefined,
    @Query() dto: ListGraphicsDto
  ) {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    const result = await listGraphics(db, { ...dto, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return {
      ...result.data,
      items: result.data.items.map(signGraphicOutputs),
    };
  }

  /**
   * Curated style pick-list for the generate-graphic dialog. Registry-backed
   * (no DB). Declared before `:id` so "templates" isn't captured as an id.
   */
  @Get('templates')
  async listTemplates(@Query('usageType') usageType?: 'organic' | 'ad') {
    const result = await listGraphicTemplates(usageType ? { usageType } : {});
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @ResponseContract(graphicSchema)
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await getGraphic(db, { id, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return signGraphicOutputs(result.data);
  }

  // ==================== AI GENERATION ====================

  /**
   * One-shot AI graphic generation triggered by the socials "New Post →
   * Graphic" flow. The service inserts a placeholder `graphic` row with
   * `status='rendering'`, returns it immediately, and enqueues a
   * `graphic-generate` job (mode='plan-and-render'). The worker runs
   * `planImageDetail` + `renderGraphicSlides`, then flips the row to
   * `'ready'` (or `'failed'`). The frontend polls `GET /graphics/:id`.
   *
   * Via `createContentGraphic`, so the graphic is opened as attempt 0 of a
   * content item and every later edit has something to append to. The bare
   * service is still what the batch planner and the onboarding ad-picker call —
   * the planner opens its own slot, and onboarding tiles are not content items.
   *
   * `itemId` and `attemptNumber` ride along, additively. Without them the
   * caller has the graphic and no handle on the thing an edit actually
   * addresses, which is what sent the assistant tools into the database to find
   * one.
   */
  @Post('generate')
  @UsePipes(new ValidationPipe({ transform: true }))
  async generate(
    @ActiveOrganization() organizationId: string,
    @CurrentUser() _user: AuthenticatedRequest['user'],
    @Body() dto: GenerateGraphicFromServiceDto
  ) {
    this.logger.log(
      `Generate graphic request for organization ${organizationId} (service=${dto.serviceId}, category=${dto.category})`
    );

    const result = await createContentGraphic(db, {
      ...dto,
      organizationId,
    });

    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return {
      ...result.data.graphic,
      itemId: result.data.itemId,
      attemptNumber: result.data.attemptNumber,
    };
  }

  /**
   * Re-roll an existing graphic with a change request (create-post review
   * modal, Claire chat). Pins the original's template; `scope:'slide'` refines
   * just one carousel slide. Returns a fresh placeholder graphic to poll.
   *
   * Goes through `reviseContent` rather than `regenerateGraphic`
   * directly, so the re-roll is recorded as the next ATTEMPT of the graphic's
   * content item, carrying the owner's instruction. The bare service is still
   * what the batch and onboarding paths call — they do their own bookkeeping,
   * and recording here as well would double-count.
   *
   * The response is unchanged: the graphic, exactly as before. The item and
   * attempt number are bookkeeping the client does not need yet.
   */
  @Post(':id/regenerate')
  @UsePipes(new ValidationPipe({ transform: true }))
  async regenerate(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') createdById: string,
    @Body() dto: RegenerateGraphicDto
  ) {
    const result = await reviseContent(db, {
      ...dto,
      kind: 'graphic',
      graphicId: id,
      organizationId,
      createdById,
    });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    // Narrowing on the kind we asked for. Anything else is a contract break,
    // not a state this endpoint should render.
    if (result.data.kind !== 'graphic') {
      throw new HttpException(
        'Expected a graphic revision',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
    return result.data.graphic;
  }

  // ==================== CLIENT-SIDE EXPORT FLOW (Track 09) ====================

  @Post(':id/outputs/upload-url')
  @UsePipes(new ValidationPipe({ transform: true }))
  async createOutputUploadUrl(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @Body() dto: CreateGraphicOutputUploadUrlDto
  ) {
    const result = await createGraphicOutputUploadUrl(
      db,
      { getOrgAssetsBucket, getPresignedUploadUrl },
      { ...dto, id, organizationId }
    );
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Post(':id/outputs/confirm')
  @UsePipes(new ValidationPipe({ transform: true }))
  async confirmOutput(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @Body() dto: ConfirmGraphicOutputDto
  ) {
    const result = await confirmGraphicOutput(
      db,
      { getOrgAssetsBucket, getPrivateCdnUrl, isCdnEnabled },
      { ...dto, id, organizationId }
    );
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ==================== WRITES ====================

  @Put(':id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async update(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @Body() dto: UpdateGraphicDto
  ) {
    const result = await updateGraphic(db, { id, organizationId, ...dto });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await deleteGraphic(db, { id, organizationId });
    if (!result.success) throw this.mapErrorToHttpException(result.error);
    return result.data;
  }

  // ==================== ERROR MAPPING ====================

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
      // INVALID_STATE is a user-actionable state conflict ("already promoted",
      // "missing a creative"). Unmapped it fell to the 500 default, and
      // sanitize-errors.filter scrubs the message on any status >= 500 in EVERY
      // environment — so the owner saw "Internal server error" for something
      // they could have fixed.
      case ErrorCodes.INVALID_STATE:
        return new HttpException(error.message, HttpStatus.BAD_REQUEST);
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case ErrorCodes.RATE_LIMITED:
        return new HttpException(error.message, HttpStatus.TOO_MANY_REQUESTS);
      default:
        return new HttpException(
          error.message,
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
