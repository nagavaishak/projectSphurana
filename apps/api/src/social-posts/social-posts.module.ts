import { Module } from '@nestjs/common';
import { SocialPostsController } from './social-posts.controller.js';

@Module({
  controllers: [SocialPostsController],
  providers: [],
  exports: [],
})
export class SocialPostsModule {}
