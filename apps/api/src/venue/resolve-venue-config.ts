import { db } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { getVenueConfig } from '@borradh-workspace/features/venue';
import { HttpException, HttpStatus, Logger } from '@nestjs/common';

const logger = new Logger('PublicVenueController');

/**
 * Load a public venue page's config, logging both ends of the call and
 * translating a failed Result into the HTTP status the public page expects.
 *
 * Was `PublicVenueController.resolveVenue`, shared by the two read routes.
 * The logging is the point of it existing at all: these routes are
 * unauthenticated and unmonitored, so a mistyped slug produces no other signal.
 */
export async function resolveVenueConfig(
  organizationSlug: string,
  locationSlug?: string
) {
  logger.log(
    `Get venue config: org=${organizationSlug} location=${locationSlug ?? '(primary)'}`
  );

  const result = await getVenueConfig(db, { organizationSlug, locationSlug });

  if (!result.success) {
    logger.warn(
      `Get venue config failed: ${result.error.code} - ${result.error.message}`
    );
    throw venueHttpException(result.error);
  }

  return result.data;
}

function venueHttpException(error: { code: string; message: string }) {
  switch (error.code) {
    case ErrorCodes.VALIDATION_ERROR:
    case ErrorCodes.INVALID_INPUT:
      return new HttpException(error.message, HttpStatus.BAD_REQUEST);
    case ErrorCodes.NOT_FOUND:
      return new HttpException(error.message, HttpStatus.NOT_FOUND);
    default:
      return new HttpException(
        error.message || 'Internal server error',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
  }
}
