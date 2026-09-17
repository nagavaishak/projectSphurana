import { db } from '@borradh-workspace/database';
import { listLocations } from '@borradh-workspace/features/organization-locations';
import { listServices } from '@borradh-workspace/features/organization-services';
import { getOrganization } from '@borradh-workspace/features/organizations';
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiKeyGuard,
  ApiKeyOrganization,
  PlanAccessGuard,
  RequireScopes,
  ScopeGuard,
} from '../../common';
import { mapError } from '../shared/map-error';

@Controller('v1/organization')
@UseGuards(ApiKeyGuard, PlanAccessGuard, ScopeGuard)
export class V1OrganizationController {
  @Get()
  @RequireScopes('organization:read')
  async getDetails(@ApiKeyOrganization('id') organizationId: string) {
    const result = await getOrganization(db, { id: organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get('locations')
  @RequireScopes('organization:read')
  async getLocations(@ApiKeyOrganization('id') organizationId: string) {
    const result = await listLocations(db, { organizationId });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }

  @Get('services')
  @RequireScopes('organization:read')
  async getServices(
    @ApiKeyOrganization('id') organizationId: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string
  ) {
    const result = await listServices(db, {
      organizationId,
      limit: limit ? Number.parseInt(limit, 10) : 50,
      offset: offset ? Number.parseInt(offset, 10) : 0,
    });
    if (!result.success) throw mapError(result.error);
    return result.data;
  }
}
