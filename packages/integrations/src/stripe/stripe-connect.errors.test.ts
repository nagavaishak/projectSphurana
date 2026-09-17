import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  describeStripeError,
  isTerminalDeauthorizeRefusal,
} from './stripe-connect.service.js';

/**
 * Both shapes below are taken from real production events (ENG-764 / ENG-765).
 * The SDK builds them from the OAuth error payload: `error` is a bare string,
 * so it lands on `rawType`, and `message` comes from `error_description`.
 */
const negativeBalanceRefusal = () =>
  new Stripe.errors.StripeAuthenticationError({
    type: 'invalid_request',
    message:
      "You cannot call deauthorize on acct_1U5kZ473uY3aAQh7 because you're responsible for negative balances on this account.",
    statusCode: 401,
    requestId: 'req_negbal',
  } as never);

const v2AccountRefusal = () =>
  new Stripe.errors.StripeUnknownError({
    type: 'unsupported_account_type',
    message: 'V2 Accounts cannot be disconnected via this endpoint.',
    statusCode: 400,
    requestId: 'req_v2',
  } as never);

describe('isTerminalDeauthorizeRefusal', () => {
  it('treats the negative-balance refusal as terminal', () => {
    expect(isTerminalDeauthorizeRefusal(negativeBalanceRefusal())).toBe(true);
  });

  it('treats the V2-account refusal as terminal', () => {
    expect(isTerminalDeauthorizeRefusal(v2AccountRefusal())).toBe(true);
  });

  it('does not treat a Stripe 5xx as a refusal', () => {
    const outage = new Stripe.errors.StripeAPIError({
      type: 'api_error',
      message: 'Stripe is temporarily unavailable',
      statusCode: 503,
    } as never);

    expect(isTerminalDeauthorizeRefusal(outage)).toBe(false);
  });

  it('does not treat a connection failure as a refusal', () => {
    const connectionError = new Stripe.errors.StripeConnectionError({
      type: 'api_connection_error',
      message: 'socket hang up',
    } as never);

    expect(isTerminalDeauthorizeRefusal(connectionError)).toBe(false);
  });

  it('does not treat a plain Error as a refusal', () => {
    expect(isTerminalDeauthorizeRefusal(new Error('boom'))).toBe(false);
    expect(isTerminalDeauthorizeRefusal(undefined)).toBe(false);
  });
});

describe('describeStripeError', () => {
  it('surfaces the Stripe fields that explain the refusal', () => {
    expect(describeStripeError(negativeBalanceRefusal())).toEqual({
      stripeErrorType: 'StripeAuthenticationError',
      stripeRawType: 'invalid_request',
      stripeErrorCode: undefined,
      stripeStatusCode: 401,
      stripeRequestId: 'req_negbal',
    });
  });

  it('returns undefined for a non-Stripe error', () => {
    expect(describeStripeError(new Error('boom'))).toBeUndefined();
  });
});
