import { describe, expect, it } from '@borradh-workspace/testing';
import { safeJobId } from './safe-job-id.js';

describe('safeJobId', () => {
  it('joins parts with a dash', () => {
    expect(safeJobId('voice-ingest', 'org123', 'page456')).toBe(
      'voice-ingest-org123-page456'
    );
  });

  it('replaces colons (BullMQ key separator) with dashes', () => {
    expect(safeJobId('flow', 'urn:meta:page:99')).toBe('flow-urn-meta-page-99');
  });

  it('replaces whitespace and slashes', () => {
    expect(safeJobId('asset', 'a b', 'c/d', 'e\\f')).toBe('asset-a-b-c-d-e-f');
  });

  it('drops null, undefined and empty parts', () => {
    expect(safeJobId('a', null, undefined, '', 'b')).toBe('a-b');
  });

  it('coerces numbers', () => {
    expect(safeJobId('dlq', 'queue', 1234)).toBe('dlq-queue-1234');
  });

  it('collapses runs of unsafe characters into a single dash', () => {
    expect(safeJobId('x::  y')).toBe('x-y');
  });
});
