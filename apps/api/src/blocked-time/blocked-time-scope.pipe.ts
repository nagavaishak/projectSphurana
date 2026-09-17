import {
  type BlockedTimeEditScope,
  blockedTimeEditScopeValues,
} from '@borradh-workspace/features/scheduling';
import {
  HttpException,
  HttpStatus,
  Injectable,
  type PipeTransform,
} from '@nestjs/common';

/**
 * `?scope=` on the recurring blocked-time edit/delete routes: which occurrences
 * the write applies to. Absent means `all`.
 *
 * Was `BlockedTimeController.parseScope`, called inline in the `update` and
 * `remove` handlers. Coercing and validating one request value is a Pipe's job
 * (Gate 5, "request shaping"), and the 400 message — which enumerates the legal
 * values — is preserved verbatim.
 */
@Injectable()
export class BlockedTimeScopePipe
  implements PipeTransform<string | undefined, BlockedTimeEditScope>
{
  transform(value: string | undefined): BlockedTimeEditScope {
    if (value === undefined) return 'all';
    if (!(blockedTimeEditScopeValues as readonly string[]).includes(value)) {
      throw new HttpException(
        `scope must be one of: ${blockedTimeEditScopeValues.join(', ')}`,
        HttpStatus.BAD_REQUEST
      );
    }
    return value as BlockedTimeEditScope;
  }
}
