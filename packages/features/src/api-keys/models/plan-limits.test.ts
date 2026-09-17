import { describe, expect, it } from '@borradh-workspace/testing';
import { PLAN_API_LIMITS, getPlanApiLimits } from './plan-limits.js';

describe('Plan API Limits', () => {
  describe('PLAN_API_LIMITS', () => {
    it('should define limits for all plan tiers', () => {
      expect(PLAN_API_LIMITS).toHaveProperty('free');
      expect(PLAN_API_LIMITS).toHaveProperty('starter');
      expect(PLAN_API_LIMITS).toHaveProperty('pro');
      expect(PLAN_API_LIMITS).toHaveProperty('enterprise');
    });

    it('should not grant API access to free plan', () => {
      expect(PLAN_API_LIMITS.free.hasApiAccess).toBe(false);
      expect(PLAN_API_LIMITS.free.maxRequestsPerHour).toBe(0);
      expect(PLAN_API_LIMITS.free.maxApiKeys).toBe(0);
    });

    it('should grant API access to paid plans', () => {
      expect(PLAN_API_LIMITS.starter.hasApiAccess).toBe(true);
      expect(PLAN_API_LIMITS.pro.hasApiAccess).toBe(true);
      expect(PLAN_API_LIMITS.enterprise.hasApiAccess).toBe(true);
    });

    it('should have increasing rate limits per tier', () => {
      expect(PLAN_API_LIMITS.starter.maxRequestsPerHour).toBeLessThan(
        PLAN_API_LIMITS.pro.maxRequestsPerHour
      );
      expect(PLAN_API_LIMITS.pro.maxRequestsPerHour).toBeLessThan(
        PLAN_API_LIMITS.enterprise.maxRequestsPerHour
      );
    });

    it('should have increasing key limits per tier', () => {
      expect(PLAN_API_LIMITS.starter.maxApiKeys).toBeLessThan(
        PLAN_API_LIMITS.pro.maxApiKeys
      );
      expect(PLAN_API_LIMITS.pro.maxApiKeys).toBeLessThan(
        PLAN_API_LIMITS.enterprise.maxApiKeys
      );
    });
  });

  describe('getPlanApiLimits', () => {
    it('should return correct limits for known plans', () => {
      expect(getPlanApiLimits('starter')).toEqual(PLAN_API_LIMITS.starter);
      expect(getPlanApiLimits('pro')).toEqual(PLAN_API_LIMITS.pro);
      expect(getPlanApiLimits('enterprise')).toEqual(
        PLAN_API_LIMITS.enterprise
      );
    });

    it('should default to free plan for unknown plan names', () => {
      expect(getPlanApiLimits('unknown')).toEqual(PLAN_API_LIMITS.free);
      expect(getPlanApiLimits('')).toEqual(PLAN_API_LIMITS.free);
    });
  });
});
