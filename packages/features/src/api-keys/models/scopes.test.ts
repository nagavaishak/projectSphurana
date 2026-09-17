import { describe, expect, it } from '@borradh-workspace/testing';
import {
  API_SCOPES,
  apiScopeValues,
  areValidScopes,
  getMissingScopes,
  hasAllScopes,
} from './scopes.js';

describe('API Scopes', () => {
  describe('API_SCOPES', () => {
    it('should have descriptions for all scopes', () => {
      for (const [scope, description] of Object.entries(API_SCOPES)) {
        expect(scope).toBeTruthy();
        expect(description).toBeTruthy();
        expect(typeof description).toBe('string');
      }
    });

    it('should follow resource:action pattern', () => {
      for (const scope of apiScopeValues) {
        expect(scope).toMatch(/^[\w-]+:(read|write)$/);
      }
    });
  });

  describe('apiScopeValues', () => {
    it('should contain all scope keys', () => {
      expect(apiScopeValues).toHaveLength(Object.keys(API_SCOPES).length);
    });
  });

  describe('hasAllScopes', () => {
    it('should return true when all required scopes are granted', () => {
      expect(
        hasAllScopes(
          ['leads:read', 'leads:write'],
          ['leads:read', 'leads:write']
        )
      ).toBe(true);
    });

    it('should return true when granted scopes are a superset', () => {
      expect(
        hasAllScopes(
          ['leads:read', 'leads:write', 'assets:read'],
          ['leads:read']
        )
      ).toBe(true);
    });

    it('should return false when a required scope is missing', () => {
      expect(hasAllScopes(['leads:read'], ['leads:read', 'leads:write'])).toBe(
        false
      );
    });

    it('should return true for empty required scopes', () => {
      expect(hasAllScopes(['leads:read'], [])).toBe(true);
    });

    it('should return false for empty granted scopes with requirements', () => {
      expect(hasAllScopes([], ['leads:read'])).toBe(false);
    });
  });

  describe('getMissingScopes', () => {
    it('should return empty array when all scopes are granted', () => {
      expect(
        getMissingScopes(['leads:read', 'leads:write'], ['leads:read'])
      ).toEqual([]);
    });

    it('should return missing scopes', () => {
      expect(
        getMissingScopes(['leads:read'], ['leads:read', 'leads:write'])
      ).toEqual(['leads:write']);
    });

    it('should return all scopes when none are granted', () => {
      expect(getMissingScopes([], ['leads:read', 'leads:write'])).toEqual([
        'leads:read',
        'leads:write',
      ]);
    });
  });

  describe('areValidScopes', () => {
    it('should return true for valid scopes', () => {
      expect(areValidScopes(['leads:read', 'leads:write'])).toBe(true);
    });

    it('should return false for invalid scopes', () => {
      expect(areValidScopes(['invalid:scope'])).toBe(false);
    });

    it('should return false when any scope is invalid', () => {
      expect(areValidScopes(['leads:read', 'invalid:scope'])).toBe(false);
    });

    it('should return true for empty array', () => {
      expect(areValidScopes([])).toBe(true);
    });
  });
});
