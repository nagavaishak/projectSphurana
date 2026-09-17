import { apiEnv } from '@borradh-workspace/env/api';
import {
  type AppVersionPolicy,
  checkAppVersion,
} from '@borradh-workspace/features/app-version';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { getAppVersion } from '@borradh-workspace/observability';
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

import { Public } from '../common/index.js';

import { CheckAppVersionDto } from './dto/index.js';

/**
 * Where to send someone who needs to update. Constants rather than env: these
 * change when the app is re-listed, which is never, and a wrong value here is
 * a dead-end button on a blocking screen.
 */
const STORE_URLS = {
  ios: 'https://apps.apple.com/app/id6759301177',
  android: 'https://play.google.com/store/apps/details?id=com.borradh.mobile',
} as const;

/**
 * The two gates are deliberately asymmetric.
 *
 * `latestVersion` falls back to this API build's own version (repo-root
 * VERSION, baked in as APP_VERSION), so the "there's a newer app" nudge tracks
 * releases instead of waiting on a hand-set literal quietly rotting — exactly
 * how Android's gradle versionName ended up a patch behind the store. Explicit
 * env values still win.
 *
 * `minimumVersion` gets NO such fallback. It BLOCKS the app, so defaulting it
 * to the deployed version would lock every user out on each release until they
 * updated. It stays unset by default and is raised by hand, only once the
 * replacement build is actually live.
 *
 * Known window on `latestVersion`: VERSION is bumped BEFORE a store build
 * (next-marketing-version.mjs requires it to exceed the highest approved
 * version), so between that bump and store approval the API advertises a
 * version users cannot download yet. The nudge is dismissible, not a gate, so
 * the cost is mild — pin MOBILE_LATEST_VERSION_* if a release sits in review.
 */
function buildPolicy(platform: 'ios' | 'android'): AppVersionPolicy {
  return {
    minimumVersion:
      platform === 'ios'
        ? apiEnv.MOBILE_MIN_VERSION_IOS
        : apiEnv.MOBILE_MIN_VERSION_ANDROID,
    latestVersion:
      (platform === 'ios'
        ? apiEnv.MOBILE_LATEST_VERSION_IOS
        : apiEnv.MOBILE_LATEST_VERSION_ANDROID) ?? getAppVersion(),
    storeUrl: STORE_URLS[platform],
  };
}

/**
 * Minimum-supported-version check for the native apps.
 *
 * Unauthenticated on purpose: a blocked build must be told it is blocked
 * before it can sign in, and the answer doesn't depend on who is asking.
 * @Public() says so out loud — without an AuthGuard in scope the route would
 * be open either way, and "open on purpose" should not read the same as
 * "nobody thought about it".
 */
@Controller('app-version')
@Public()
// Every cold start of every install hits this. Rate limiting it by IP would
// mostly punish users sharing a carrier NAT, and the handler does no I/O —
// it compares two version strings.
@SkipThrottle()
export class AppVersionController {
  @Get('check')
  @UsePipes(new ValidationPipe({ transform: true }))
  async check(@Query() dto: CheckAppVersionDto) {
    const policy = buildPolicy(dto.platform);

    const result = await checkAppVersion(dto, policy);
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      [ErrorCodes.VALIDATION_ERROR]: HttpStatus.BAD_REQUEST,
    };
    return new HttpException(
      error.message,
      map[error.code] || HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
