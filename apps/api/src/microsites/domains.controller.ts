import { db } from '@borradh-workspace/database';
import {
  addMicrositeDomain,
  listMicrositeDomains,
  removeMicrositeDomain,
} from '@borradh-workspace/features/microsites';
import {
  changePrimaryDomain,
  checkDomainNow,
} from '@borradh-workspace/features/microsites/domain-verification';
import { createVercelDomainProvider } from '@borradh-workspace/integrations/domains';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ActiveOrganization,
  AuthGuard,
  MicrositeEditorGuard,
} from '../common/index.js';
import { AddMicrositeDomainDto, ListMicrositeDomainsDto } from './dto/index.js';

/**
 * Custom domains for a microsite (contract §2).
 *
 * Transport only. Every route hands the caller's `organizationId` — from the
 * SESSION, never the body — to a service that enforces it as a WHERE-clause
 * predicate, so a `micrositeId` or `domainId` from another tenant is NOT_FOUND
 * rather than FORBIDDEN.
 *
 * Promoting a domain goes through `changePrimaryDomain`, not `setPrimaryDomain`
 * directly: a primary change owes the contract §4 fan-out (301 the old host,
 * rewrite live ad destinations, re-verify with Meta) whether it was the
 * verification poller or a person that caused it. Wiring the bare service here
 * is how the UI path would silently skip all three.
 *
 * The provider is built lazily so importing this controller does not read
 * Vercel credentials, and the token itself is never named here — the adapter
 * owns it (contract §6).
 */
const domainProvider = () => createVercelDomainProvider();

@Controller('microsites/:id/domains')
@UseGuards(MicrositeEditorGuard, AuthGuard)
export class MicrositeDomainsController {
  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async add(
    @Param('id') micrositeId: string,
    @Body() dto: AddMicrositeDomainDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await addMicrositeDomain(
      db,
      { micrositeId, organizationId, domain: dto.domain },
      { provider: domainProvider() }
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Get()
  @UsePipes(new ValidationPipe({ transform: true }))
  async list(
    @Param('id') micrositeId: string,
    @Query() dto: ListMicrositeDomainsDto,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await listMicrositeDomains(db, {
      micrositeId,
      organizationId,
      includeRemoved: dto.includeRemoved,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** "Check now" — one immediate poll, then the current row. */
  @Get(':domainId/status')
  async status(
    @Param('id') micrositeId: string,
    @Param('domainId') domainId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await checkDomainNow(
      db,
      { domainId, micrositeId, organizationId },
      { provider: domainProvider() }
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  /** Promote to canonical, and run everything a host change owes (§4). */
  @Post(':domainId/primary')
  async setPrimary(
    @Param('id') micrositeId: string,
    @Param('domainId') domainId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await changePrimaryDomain(db, {
      domainId,
      micrositeId,
      organizationId,
    });
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  @Delete(':domainId')
  async remove(
    @Param('id') micrositeId: string,
    @Param('domainId') domainId: string,
    @ActiveOrganization() organizationId: string
  ) {
    const result = await removeMicrositeDomain(
      db,
      { domainId, micrositeId, organizationId },
      { provider: domainProvider() }
    );
    if (!result.success) throw this.mapError(result.error);
    return result.data;
  }

  private mapError(error: { code: string; message: string }) {
    const map: Record<string, HttpStatus> = {
      VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
      UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
      FORBIDDEN: HttpStatus.FORBIDDEN,
      NOT_FOUND: HttpStatus.NOT_FOUND,
      ALREADY_EXISTS: HttpStatus.CONFLICT,
      CONFLICT: HttpStatus.CONFLICT,
    };
    return new HttpException(
      error.message,
      map[error.code] ?? HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}
