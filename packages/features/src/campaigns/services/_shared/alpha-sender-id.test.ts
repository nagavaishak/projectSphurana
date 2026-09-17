import { describe, expect, it } from '@borradh-workspace/testing';
import {
  deriveAlphaSenderId,
  isValidAlphaSenderId,
} from './alpha-sender-id.js';

describe('isValidAlphaSenderId', () => {
  it('accepts a normal branded id', () => {
    expect(isValidAlphaSenderId('BloomHair')).toBe(true);
  });

  it('accepts letters mixed with digits', () => {
    expect(isValidAlphaSenderId('Glow24')).toBe(true);
  });

  it('rejects an id longer than 11 chars', () => {
    expect(isValidAlphaSenderId('BloomHairSalon')).toBe(false);
  });

  it('rejects an empty id', () => {
    expect(isValidAlphaSenderId('')).toBe(false);
  });

  it('rejects spaces and punctuation', () => {
    expect(isValidAlphaSenderId('Bloom Hair')).toBe(false);
    expect(isValidAlphaSenderId('Bloom-Hair')).toBe(false);
  });

  it('rejects an all-numeric id (reads as a number)', () => {
    expect(isValidAlphaSenderId('12345')).toBe(false);
  });
});

describe('deriveAlphaSenderId', () => {
  it('joins words and drops spaces', () => {
    expect(deriveAlphaSenderId('Bloom Hair')).toBe('BloomHair');
  });

  it('truncates to 11 chars', () => {
    expect(deriveAlphaSenderId('Bloom Hair Salon & Spa')).toBe('BloomHairSa');
  });

  it('strips accents and punctuation', () => {
    expect(deriveAlphaSenderId('Café Léa!')).toBe('CafeLea');
  });

  it('keeps a leading letter with trailing digits', () => {
    expect(deriveAlphaSenderId('Studio 54')).toBe('Studio54');
  });

  it('returns null when the name reduces to nothing usable', () => {
    expect(deriveAlphaSenderId('---')).toBeNull();
    expect(deriveAlphaSenderId('   ')).toBeNull();
  });

  it('returns null when the name reduces to digits only', () => {
    expect(deriveAlphaSenderId('123 456')).toBeNull();
  });
});
