import { describe, expect, it } from 'vitest';
import {
  isDeadlock,
  isForeignKeyViolation,
  isUniqueViolation,
  mapDbError,
  pgViolation,
} from './constraints.js';
import {
  drizzleFkViolation,
  drizzleUniqueViolation,
} from './testing/pg-error.js';

/** Build a drizzle-style wrapper around a postgres.js error. */
const wrapped = (inner: Record<string, unknown>) =>
  Object.assign(new Error('Failed query: insert into "organization_service"'), {
    cause: Object.assign(new Error(String(inner.message ?? 'pg error')), inner),
  });

describe('isUniqueViolation', () => {
  it('detects 23505 on the error itself', () => {
    const error = Object.assign(new Error('dup'), { code: '23505' });
    expect(isUniqueViolation(error)).toBe(true);
  });

  it('detects 23505 on the cause chain (drizzle wrapper)', () => {
    expect(isUniqueViolation(wrapped({ code: '23505' }))).toBe(true);
  });

  it('matches a named constraint via constraint_name', () => {
    const error = wrapped({
      code: '23505',
      constraint_name: 'organization_service_name_unique',
    });
    expect(isUniqueViolation(error, 'organization_service_name_unique')).toBe(
      true
    );
  });

  it('rejects a different named constraint', () => {
    const error = wrapped({
      code: '23505',
      constraint_name: 'some_other_unique',
    });
    expect(isUniqueViolation(error, 'organization_service_name_unique')).toBe(
      false
    );
  });

  it('falls back to the message when no constraint field is present', () => {
    const error = wrapped({
      code: '23505',
      message:
        'duplicate key value violates unique constraint "organization_service_name_unique"',
    });
    expect(isUniqueViolation(error, 'organization_service_name_unique')).toBe(
      true
    );
  });

  it('supports the `constraint` field spelling', () => {
    const error = wrapped({
      code: '23505',
      constraint: 'organization_service_name_unique',
    });
    expect(isUniqueViolation(error, 'organization_service_name_unique')).toBe(
      true
    );
  });

  it('returns false for non-unique-violation errors', () => {
    expect(isUniqueViolation(wrapped({ code: '23503' }))).toBe(false);
    expect(isUniqueViolation(wrapped({ code: 'ECONNRESET' }))).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
  });

  it('terminates on a self-referential cause chain', () => {
    const error: Record<string, unknown> = { code: 'X', message: 'loop' };
    error.cause = error;
    expect(isUniqueViolation(error)).toBe(false);
  });
});

describe('isDeadlock', () => {
  it('detects 40P01 on the error itself', () => {
    const error = Object.assign(new Error('deadlock detected'), {
      code: '40P01',
    });
    expect(isDeadlock(error)).toBe(true);
  });

  it('detects 40P01 on the cause chain (drizzle wrapper)', () => {
    // The shape CI actually produced: drizzle's outer error carries the SQL
    // text, and the driver error underneath carries the SQLSTATE. A classifier
    // that only inspected the top-level error would miss every real one.
    expect(
      isDeadlock(wrapped({ code: '40P01', message: 'deadlock detected' }))
    ).toBe(true);
  });

  it('does NOT fire on a message that merely says "deadlock"', () => {
    // The signal is the SQLSTATE, never the text — an application error that
    // happens to describe a deadlock is a real fault and must stay one.
    expect(
      isDeadlock(wrapped({ code: '42P01', message: 'deadlock detected' }))
    ).toBe(false);
  });

  it('does not confuse a deadlock with the constraint violations', () => {
    expect(isDeadlock(wrapped({ code: '23P01' }))).toBe(false);
    expect(isDeadlock(wrapped({ code: '23505' }))).toBe(false);
    expect(isDeadlock(new Error('boom'))).toBe(false);
    expect(isDeadlock(null)).toBe(false);
    expect(isDeadlock(undefined)).toBe(false);
  });

  it('terminates on a self-referential cause chain', () => {
    const error: Record<string, unknown> = { code: 'X', message: 'loop' };
    error.cause = error;
    expect(isDeadlock(error)).toBe(false);
  });
});

describe('pgViolation', () => {
  it('extracts code, constraint, detail, and table from a unique violation', () => {
    const error = drizzleUniqueViolation('practitioner_org_email_unique', {
      detail: 'Key (email)=(a@b.com) already exists.',
      table: 'practitioner',
    });
    expect(pgViolation(error)).toEqual({
      code: '23505',
      constraint: 'practitioner_org_email_unique',
      detail: 'Key (email)=(a@b.com) already exists.',
      table: 'practitioner',
    });
  });

  it('extracts an FK violation', () => {
    const error = drizzleFkViolation('asset_service_asset_id_asset_id_fk', {
      table: 'asset_service',
    });
    expect(pgViolation(error)).toMatchObject({
      code: '23503',
      constraint: 'asset_service_asset_id_asset_id_fk',
    });
  });

  it('returns null for a non-Postgres error', () => {
    expect(pgViolation(new Error('boom'))).toBeNull();
    expect(pgViolation(null)).toBeNull();
  });

  it('does not report an unrelated `code` field (e.g. Node error codes) as a violation', () => {
    const error = wrapped({ code: 'ECONNRESET' });
    expect(pgViolation(error)).toBeNull();
  });

  it('terminates on a self-referential cause chain', () => {
    const error: Record<string, unknown> = { code: 'X', message: 'loop' };
    error.cause = error;
    expect(pgViolation(error)).toBeNull();
  });
});

describe('mapDbError', () => {
  it('builds the mapped error for a matching constraint', () => {
    const error = drizzleUniqueViolation('uq_intake_form_org_name');
    const result = mapDbError(error, {
      uq_intake_form_org_name: () => 'already-exists',
      some_other_constraint: () => 'wrong-one',
    });
    expect(result).toBe('already-exists');
  });

  it('returns null for a violation on a constraint not in the map', () => {
    const error = drizzleUniqueViolation('some_unmapped_constraint');
    const result = mapDbError(error, {
      uq_intake_form_org_name: () => 'already-exists',
    });
    expect(result).toBeNull();
  });

  it('returns null for a non-violation error', () => {
    const result = mapDbError(new Error('boom'), {
      uq_intake_form_org_name: () => 'already-exists',
    });
    expect(result).toBeNull();
  });
});

describe('isForeignKeyViolation', () => {
  it('detects 23503 via the fixture factory', () => {
    const error = drizzleFkViolation('asset_service_asset_id_asset_id_fk');
    expect(
      isForeignKeyViolation(error, 'asset_service_asset_id_asset_id_fk')
    ).toBe(true);
    expect(isForeignKeyViolation(error, 'some_other_fk')).toBe(false);
  });
});
