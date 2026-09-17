import { describe, expect, it } from 'vitest';
import { humanizeBatchError } from './batch-review-banner';

describe('humanizeBatchError', () => {
  it('points the owner at uploading media when no service has usable assets', () => {
    expect(
      humanizeBatchError(
        'Planning failed: No services with usable media or video footage to plan content for'
      )
    ).toBe(
      'None of your services have photos or videos yet. Upload some media to a service, then try again.'
    );
  });

  it('points the owner at adding a service when none are active', () => {
    expect(
      humanizeBatchError('Planning failed: No active services for organization')
    ).toBe(
      'You have no active services. Add or activate a service, then try again.'
    );
  });

  it('asks the owner to wait when the planner is rate limited', () => {
    expect(humanizeBatchError('Anthropic API error: rate limit exceeded')).toBe(
      'Our content planner is briefly overloaded. Try again in a few minutes.'
    );
  });

  it('matches rate limit regardless of casing', () => {
    expect(humanizeBatchError('429 Rate Limit Exceeded')).toBe(
      'Our content planner is briefly overloaded. Try again in a few minutes.'
    );
  });

  it('falls back to a generic retry line for an unrecognised message', () => {
    expect(humanizeBatchError('ECONNRESET reading from upstream')).toBe(
      'Something went wrong while planning your content. Try again — if it keeps failing, contact support.'
    );
  });

  it('falls back to a generic retry line when there is no message at all', () => {
    expect(humanizeBatchError(null)).toBe(
      'Something went wrong while planning your content. Try again — if it keeps failing, contact support.'
    );
  });
});
