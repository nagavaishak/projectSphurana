import { db } from '@borradh-workspace/database';
import {
  deleteMemory,
  editMemory,
  listContentRules,
  listMemories,
  saveContentRule,
} from '@borradh-workspace/features/assistant';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ActiveOrganization, AuthGuard, CurrentUser } from '../common/index.js';
// Direct imports (not via the dto barrel) to avoid pulling sibling DTOs'
// schemas into this controller's eager-evaluation chain at test time.
// Same pattern as `uploads.controller.ts`.
import { EditMemoryDto } from './dto/edit-memory.dto.js';
import { ListMemoriesDto } from './dto/list-memories.dto.js';
import { SaveContentRuleDto } from './dto/save-content-rule.dto.js';

/**
 * Memory CRUD endpoints for the C-14 settings UI.
 *
 * The user-facing surface lives at `/settings/claire/memories` (frontend).
 * This controller exposes the backing endpoints:
 *
 *   - `GET    /assistant/memories`       — list user-managed memories
 *                                          (org-wide ∪ caller's personal)
 *   - `PATCH  /assistant/memories/:id`   — edit memory content (re-embeds)
 *   - `DELETE /assistant/memories/:id`   — delete memory
 *
 * All three are scoped to `type: 'preference'` rows — conversation summaries
 * and operational snapshots are populator output and not user-managed.
 *
 * Authorization:
 *   - Personal entries (`user_id = $userId`) → owner only.
 *   - Org-wide entries (`user_id IS NULL`)   → org admin/owner only.
 *
 * The services apply these rules and return `FORBIDDEN`/`NOT_FOUND`; the
 * controller maps to HTTP status via `mapError`.
 */
@Controller('assistant')
@UseGuards(AuthGuard)
export class MemoriesController {
  private requireActiveOrganization(organizationId: string): string {
    if (!organizationId) {
      throw new HttpException(
        'No active organization selected',
        HttpStatus.BAD_REQUEST
      );
    }
    return organizationId;
  }

  @Get('memories')
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @Query() dto: ListMemoriesDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await listMemories(db, {
      organizationId: this.requireActiveOrganization(organizationId),
      userId,
      type: dto.type,
      limit: dto.limit,
      offset: dto.offset,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  /**
   * The org's standing content rules — the chip strip in the content review
   * workspace.
   *
   * A narrower read than `GET memories`: org-wide only (never someone's
   * personal preference), content-domain only, unpaginated, and ordered so the
   * chips are stable between renders. Deleting one goes through
   * `DELETE memories/:id` above, which already enforces admin-only for
   * org-wide entries — there is no second delete path here.
   */
  @Get('content-rules')
  async listRules(@ActiveOrganization() organizationId: string) {
    const result = await listContentRules(db, {
      organizationId: this.requireActiveOrganization(organizationId),
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  /**
   * Promote an instruction from a review thread into a standing rule. Only
   * ever called from an explicit user action — Claire suggests, the user taps.
   */
  @Post('content-rules')
  @UsePipes(new ValidationPipe({ transform: true }))
  async saveRule(
    @Body() dto: SaveContentRuleDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await saveContentRule(db, {
      organizationId: this.requireActiveOrganization(organizationId),
      title: dto.title,
      content: dto.content,
      batchId: dto.batchId,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  @Patch('memories/:id')
  @UsePipes(new ValidationPipe({ transform: true }))
  async edit(
    @Param('id') id: string,
    @Body() dto: EditMemoryDto,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await editMemory(db, {
      id,
      organizationId: this.requireActiveOrganization(organizationId),
      userId,
      content: dto.content,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return result.data;
  }

  @Delete('memories/:id')
  async remove(
    @Param('id') id: string,
    @ActiveOrganization() organizationId: string,
    @CurrentUser('id') userId: string
  ) {
    const result = await deleteMemory(db, {
      id,
      organizationId: this.requireActiveOrganization(organizationId),
      userId,
    });

    if (!result.success) {
      throw this.mapError(result.error);
    }

    return { deleted: true, knowledgeEntryId: result.data.knowledgeEntryId };
  }

  private mapError(error: { code: string; message: string }) {
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
      // Reachable via `POST content-rules`: a duplicate rule, or one past the
      // cap. Both carry a message the user can act on, so they must not be
      // flattened into a 500.
      case ErrorCodes.ALREADY_EXISTS:
      case ErrorCodes.CONFLICT:
        return new HttpException(error.message, HttpStatus.CONFLICT);
      case ErrorCodes.EXTERNAL_SERVICE_ERROR:
        return new HttpException(error.message, HttpStatus.BAD_GATEWAY);
      default:
        return new HttpException(
          error.message || 'Failed to process memory request',
          HttpStatus.INTERNAL_SERVER_ERROR
        );
    }
  }
}
