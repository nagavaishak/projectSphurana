import { resource } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { atLocationOrUnscoped } from './location-scope.js';
import { predicateSql } from './sql-predicate.test-utils.js';

describe('atLocationOrUnscoped', () => {
  it('matches the branch OR a row that belongs to no branch', () => {
    const sql = predicateSql(
      atLocationOrUnscoped(resource.locationId, 'loc_1')
    );

    expect(sql).toContain('[col:location_id] = ?loc_1');
    expect(sql).toContain('[col:location_id] is null');
  });

  it('is a disjunction, not a conjunction', () => {
    // The whole point: `and` here would match nothing at all, since a column
    // cannot simultaneously equal a value and be null.
    const sql = predicateSql(
      atLocationOrUnscoped(resource.locationId, 'loc_1')
    );

    expect(sql).toContain(' or ');
    expect(sql).not.toContain(' and ');
  });
});
