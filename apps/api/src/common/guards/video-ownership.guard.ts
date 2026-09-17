import { db } from '@borradh-workspace/database';
import { getVideo } from '@borradh-workspace/features/videos';
import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Verify that the `:id` video belongs to the caller's active organization.
 *
 * Was `VideosController.verifyVideoOwnership`, called as the first line of ~10
 * handlers. Policy is a Guard's job (Gate 5), and the status split below is the
 * actual contract — pinned by `videos-controller.int-spec.ts`:
 *
 *   - video exists but belongs to another org → 403 (NOT 404)
 *   - video does not exist at all             → 404
 *
 * The 403 leaks the existence of another org's video id. That is preserved
 * here as-is; changing it is a product decision, not a refactor.
 */
@Injectable()
export class VideoOwnershipGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & { params?: Record<string, string> }>();

    const videoId = request.params?.id;
    if (!videoId) return true;

    const result = await getVideo(db, { id: videoId });

    if (!result.success || !result.data) {
      throw new HttpException('Video not found', HttpStatus.NOT_FOUND);
    }

    if (result.data.organizationId !== request.activeOrganizationId) {
      throw new HttpException(
        'You do not have access to this video',
        HttpStatus.FORBIDDEN
      );
    }

    return true;
  }
}
