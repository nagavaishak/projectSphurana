import { describe, expect, it } from 'vitest';
import {
  checkSignupEmail,
  getEmailDomain,
  isDeliverableEmailFormat,
  isDisposableEmail,
} from './email-validation.js';

describe('isDeliverableEmailFormat', () => {
  it('accepts well-formed addresses', () => {
    expect(isDeliverableEmailFormat('user@example.com')).toBe(true);
    expect(isDeliverableEmailFormat('first.last@sub.example.co.uk')).toBe(true);
    expect(isDeliverableEmailFormat('user+tag@example.io')).toBe(true);
  });

  it('rejects addresses with no TLD (Resend "Invalid to field")', () => {
    expect(isDeliverableEmailFormat('foo@localhost')).toBe(false);
    expect(isDeliverableEmailFormat('foo@bar')).toBe(false);
  });

  it('rejects leading/trailing/consecutive dots', () => {
    expect(isDeliverableEmailFormat('.user@example.com')).toBe(false);
    expect(isDeliverableEmailFormat('user.@example.com')).toBe(false);
    expect(isDeliverableEmailFormat('a..b@example.com')).toBe(false);
    expect(isDeliverableEmailFormat('user@example..com')).toBe(false);
  });

  it('rejects malformed shapes', () => {
    expect(isDeliverableEmailFormat('')).toBe(false);
    expect(isDeliverableEmailFormat('no-at-sign.com')).toBe(false);
    expect(isDeliverableEmailFormat('@example.com')).toBe(false);
    expect(isDeliverableEmailFormat('user@')).toBe(false);
    expect(isDeliverableEmailFormat('user@-example.com')).toBe(false);
    expect(isDeliverableEmailFormat('user@example.c')).toBe(false);
    expect(isDeliverableEmailFormat(`${'a'.repeat(300)}@example.com`)).toBe(
      false
    );
  });
});

describe('getEmailDomain', () => {
  it('lowercases and extracts the domain', () => {
    expect(getEmailDomain('User@Example.COM')).toBe('example.com');
  });
  it('returns null for malformed input', () => {
    expect(getEmailDomain('no-at')).toBeNull();
    expect(getEmailDomain('user@')).toBeNull();
  });
});

describe('isDisposableEmail', () => {
  it('flags known disposable providers (case-insensitive)', () => {
    expect(isDisposableEmail('bot@mailinator.com')).toBe(true);
    expect(isDisposableEmail('BOT@Guerrillamail.com')).toBe(true);
    expect(isDisposableEmail('x@yopmail.fr')).toBe(true);
  });
  it('does not flag legitimate providers', () => {
    expect(isDisposableEmail('real@gmail.com')).toBe(false);
    expect(isDisposableEmail('team@borradh.io')).toBe(false);
  });
});

describe('checkSignupEmail', () => {
  it('returns null for a valid, non-disposable email', () => {
    expect(checkSignupEmail('real.person@gmail.com')).toBeNull();
  });
  it('flags invalid format first', () => {
    expect(checkSignupEmail('foo@localhost')).toBe('invalid_format');
  });
  it('flags disposable domains', () => {
    expect(checkSignupEmail('bot@mailinator.com')).toBe('disposable_domain');
  });
});
