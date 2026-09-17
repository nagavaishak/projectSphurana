import { describe, expect, it } from '@borradh-workspace/testing';
import { mapMetaAdStatus } from './map-meta-ad-status.js';

describe('mapMetaAdStatus', () => {
  it('maps ACTIVE to active', () => {
    expect(mapMetaAdStatus('ACTIVE')).toBe('active');
  });

  it('maps PAUSED to paused', () => {
    expect(mapMetaAdStatus('PAUSED')).toBe('paused');
  });

  it('maps PENDING_REVIEW to pending', () => {
    expect(mapMetaAdStatus('PENDING_REVIEW')).toBe('pending');
  });

  it('maps DISAPPROVED to rejected', () => {
    expect(mapMetaAdStatus('DISAPPROVED')).toBe('rejected');
  });

  it('maps DELETED to error', () => {
    expect(mapMetaAdStatus('DELETED')).toBe('error');
  });

  it('maps ARCHIVED to paused', () => {
    expect(mapMetaAdStatus('ARCHIVED')).toBe('paused');
  });

  it('maps WITH_ISSUES to error', () => {
    expect(mapMetaAdStatus('WITH_ISSUES')).toBe('error');
  });

  // Regression: IN_PROCESS used to map to 'draft', which made an ad that was
  // live on Meta render as "In draft" and told owners nothing was live yet.
  it('maps IN_PROCESS to pending, not draft', () => {
    expect(mapMetaAdStatus('IN_PROCESS')).toBe('pending');
  });

  it('never returns draft — an ad Meta knows about is published', () => {
    const metaStatuses = [
      'ACTIVE',
      'PAUSED',
      'PENDING_REVIEW',
      'DISAPPROVED',
      'DELETED',
      'ARCHIVED',
      'WITH_ISSUES',
      'IN_PROCESS',
      'CAMPAIGN_PAUSED',
      'ADSET_PAUSED',
      'SOME_UNKNOWN_STATUS',
      '',
    ];
    for (const status of metaStatuses) {
      expect(mapMetaAdStatus(status)).not.toBe('draft');
    }
  });

  it('maps CAMPAIGN_PAUSED to paused', () => {
    expect(mapMetaAdStatus('CAMPAIGN_PAUSED')).toBe('paused');
  });

  it('maps ADSET_PAUSED to paused', () => {
    expect(mapMetaAdStatus('ADSET_PAUSED')).toBe('paused');
  });

  it('defaults unknown status to paused', () => {
    expect(mapMetaAdStatus('SOME_UNKNOWN_STATUS')).toBe('paused');
  });

  it('defaults empty string to paused', () => {
    expect(mapMetaAdStatus('')).toBe('paused');
  });
});
