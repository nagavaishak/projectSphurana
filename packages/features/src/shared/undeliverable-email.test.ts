import { describe, expect, it } from '@borradh-workspace/testing';
import { isUndeliverableEmail } from './undeliverable-email.js';

describe('isUndeliverableEmail', () => {
  it('flags RFC 2606 reserved second-level domains as undeliverable', () => {
    expect(isUndeliverableEmail('user@example.com')).toBe(true);
    expect(isUndeliverableEmail('user@example.net')).toBe(true);
    expect(isUndeliverableEmail('user@example.org')).toBe(true);
  });

  it('flags reserved TLDs as undeliverable', () => {
    expect(isUndeliverableEmail('user@foo.test')).toBe(true);
    expect(isUndeliverableEmail('user@foo.invalid')).toBe(true);
    expect(isUndeliverableEmail('user@foo.example')).toBe(true);
    expect(isUndeliverableEmail('user@foo.localhost')).toBe(true);
  });

  it('treats real domains as deliverable', () => {
    expect(isUndeliverableEmail('someone@gmail.com')).toBe(false);
    expect(isUndeliverableEmail('booking@borradh.io')).toBe(false);
    expect(isUndeliverableEmail('jane.doe@salon-luxe.co.uk')).toBe(false);
  });

  it('does not treat non-reserved domains that merely contain "example" as undeliverable', () => {
    expect(isUndeliverableEmail('user@example.io')).toBe(false);
    expect(isUndeliverableEmail('user@myexample.com')).toBe(false);
  });

  it('is case-insensitive on the domain', () => {
    expect(isUndeliverableEmail('User@Example.COM')).toBe(true);
    expect(isUndeliverableEmail('User@Foo.TEST')).toBe(true);
    expect(isUndeliverableEmail('User@GMAIL.com')).toBe(false);
  });

  it('treats malformed / empty input as undeliverable', () => {
    expect(isUndeliverableEmail('')).toBe(true);
    expect(isUndeliverableEmail(null)).toBe(true);
    expect(isUndeliverableEmail(undefined)).toBe(true);
    expect(isUndeliverableEmail('not-an-email')).toBe(true);
  });

  it('uses the last @ to determine the domain', () => {
    expect(isUndeliverableEmail('weird@name@example.com')).toBe(true);
    expect(isUndeliverableEmail('weird@name@gmail.com')).toBe(false);
  });
});
