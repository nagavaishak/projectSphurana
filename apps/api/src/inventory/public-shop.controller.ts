import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/index.js';
import {
  createPublicShopCheckout,
  getPublicShopOrder,
  getPublicShopProduct,
  listCollectionLocations,
  listPublicShop,
  registerRestockNotification,
} from './public-shop.service.js';

/**
 * Anonymous customer routes. @Public() makes their deliberately unauthenticated
 * nature explicit; the business work lives in public-shop.service.ts.
 */
@Public()
@Controller('public/shop')
export class PublicShopController {
  @Get(':organizationSlug')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async list(@Param('organizationSlug') slug: string) {
    return listPublicShop(slug);
  }

  @Get(':organizationSlug/collection-locations')
  async collectionLocations(@Param('organizationSlug') slug: string) {
    return listCollectionLocations(slug);
  }

  @Get(':organizationSlug/:productId')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async detail(
    @Param('organizationSlug') slug: string,
    @Param('productId') productId: string
  ) {
    return getPublicShopProduct(slug, productId);
  }

  @Get(':organizationSlug/orders/:accessToken')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async orderStatus(
    @Param('organizationSlug') slug: string,
    @Param('accessToken') accessToken: string
  ) {
    return getPublicShopOrder(slug, accessToken);
  }

  @Post(':organizationSlug/checkout')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async checkout(
    @Param('organizationSlug') slug: string,
    @Body() body: unknown
  ) {
    return createPublicShopCheckout(slug, body);
  }

  @Post(':organizationSlug/:productId/notify-me')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async notify(
    @Param('organizationSlug') slug: string,
    @Param('productId') productId: string,
    @Body() body: unknown
  ) {
    return registerRestockNotification(slug, productId, body);
  }
}
