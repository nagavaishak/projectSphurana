import { Module } from '@nestjs/common';
import { OrganizationController } from './organization.controller';

/**
 * Organization Module
 *
 * Handles user-session-specific organization operations.
 * Uses singular '/organization' route prefix for session-specific operations,
 * distinct from the plural '/organizations' RESTful resource routes.
 */
@Module({
  controllers: [OrganizationController],
})
export class OrganizationModule {}
