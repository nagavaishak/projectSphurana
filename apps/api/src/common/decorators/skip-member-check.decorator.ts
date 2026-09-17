import { SetMetadata } from '@nestjs/common';

export const SKIP_MEMBER_CHECK_KEY = 'skipMemberCheck';
export const SkipMemberCheck = () => SetMetadata(SKIP_MEMBER_CHECK_KEY, true);
