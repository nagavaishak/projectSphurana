import { describe, expect, it } from 'vitest';
import { GRAPH_ENDPOINTS } from './endpoints.js';
import { REQUEST_SCHEMAS, UNVALIDATED_WRITES } from './fake/request-schemas.js';
import { RESPONDERS } from './fake/responders.js';
import { RESPONSE_SCHEMAS } from './response-schemas.js';

/**
 * COMPLETENESS GATE for the contract registry.
 *
 * Every gap this file guards was a REAL gap found by hand-auditing the registry
 * after it was written: 8 write endpoints with no request schema (so the fake
 * accepted any payload) and 6 endpoints with no response schema (so the nightly
 * never checked them). None of that was visible in review, because a missing
 * map entry looks exactly like a deliberate omission.
 *
 * The fix is to make omissions DECLARE THEMSELVES: a write endpoint must have a
 * schema or an explicit reason it can't. This test is what makes that stick as
 * the registry grows.
 */

const WRITE_METHODS = new Set(['POST', 'DELETE']);

const writeEndpoints = GRAPH_ENDPOINTS.filter((e) =>
  WRITE_METHODS.has(e.method)
);

describe('contract completeness', () => {
  it('every write endpoint is either validated or explicitly excused', () => {
    const unaccounted = writeEndpoints
      .filter(
        (e) => !(e.id in REQUEST_SCHEMAS) && !(e.id in UNVALIDATED_WRITES)
      )
      .map((e) => `${e.id} (${e.method})`);

    expect(
      unaccounted,
      unaccounted.length === 0
        ? ''
        : [
            'These write endpoints have no request schema and no documented reason:',
            ...unaccounted.map((e) => `  - ${e}`),
            '',
            'Add a strict schema to schemas.ts + REQUEST_SCHEMAS, or — if the body',
            'genuinely cannot be validated (multipart, no body, free-form) — add an',
            'entry to UNVALIDATED_WRITES saying why. Do not leave it absent: the fake',
            'will accept any payload and the "added a parameter" detection silently',
            'stops applying to that endpoint.',
          ].join('\n')
    ).toEqual([]);
  });

  it('every endpoint has a responder, or the fake would throw at runtime', () => {
    const missing = GRAPH_ENDPOINTS.filter((e) => !(e.id in RESPONDERS)).map(
      (e) => e.id
    );
    expect(missing).toEqual([]);
  });

  it('no stale entries — every schema/responder maps to a real endpoint', () => {
    // Catches the other direction: an endpoint renamed or removed leaves dead
    // entries that look like coverage but match nothing.
    const known = new Set(GRAPH_ENDPOINTS.map((e) => e.id));
    const stale = [
      ...Object.keys(REQUEST_SCHEMAS),
      ...Object.keys(RESPONSE_SCHEMAS),
      ...Object.keys(RESPONDERS),
      ...Object.keys(UNVALIDATED_WRITES),
    ].filter((id) => !known.has(id));

    expect([...new Set(stale)]).toEqual([]);
  });

  it('an endpoint is never both validated and excused', () => {
    const both = Object.keys(UNVALIDATED_WRITES).filter(
      (id) => id in REQUEST_SCHEMAS
    );
    expect(both).toEqual([]);
  });

  it('every excuse says something', () => {
    for (const [id, reason] of Object.entries(UNVALIDATED_WRITES)) {
      expect(reason.length, `${id} has a token excuse`).toBeGreaterThan(30);
    }
  });

  it('endpoint ids are unique', () => {
    const ids = GRAPH_ENDPOINTS.map((e) => e.id);
    expect(ids).toHaveLength(new Set(ids).size);
  });
});
