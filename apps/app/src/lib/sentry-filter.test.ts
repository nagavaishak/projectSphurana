import { describe, expect, it } from 'vitest';
import { classifyDroppableEvent } from './sentry-filter';

const exc = (
  type: string,
  value: string,
  filenames: string[] = ['app:///assets/index.js']
) => ({
  exception: {
    values: [
      {
        type,
        value,
        stacktrace: { frames: filenames.map((f) => ({ filename: f })) },
      },
    ],
  },
});

describe('classifyDroppableEvent', () => {
  describe('drops', () => {
    it('MetaMask injection (ENG-511)', () => {
      expect(
        classifyDroppableEvent(exc('i', 'Failed to connect to MetaMask'))
      ).toBe('browser-extension');
    });

    it('anything with an extension frame, whatever the message', () => {
      expect(
        classifyDroppableEvent(
          exc('TypeError', 'x is not a function', [
            'chrome-extension://abcdef/inject.js',
          ])
        )
      ).toBe('browser-extension');
    });

    it('expired session (ENG-441 / ENG-534)', () => {
      expect(
        classifyDroppableEvent(exc('HTTPError', 'Invalid or expired session'))
      ).toBe('expected-user-condition');
    });

    it('plan gating (ENG-414 / ENG-497)', () => {
      expect(
        classifyDroppableEvent(
          exc('HTTPError', 'A paid plan is required for this action')
        )
      ).toBe('expected-user-condition');
    });

    it('declined browser permission (ENG-508)', () => {
      expect(
        classifyDroppableEvent(
          exc(
            'NotAllowedError',
            'The request is not allowed by the user agent or the platform in the current context, possibly because the user denied permission.'
          )
        )
      ).toBe('expected-user-condition');
    });

    it('client connectivity (ENG-539 / ENG-540 / ENG-440)', () => {
      expect(classifyDroppableEvent(exc('TypeError', 'Failed to fetch'))).toBe(
        'client-network'
      );
      expect(classifyDroppableEvent(exc('TypeError', 'Load failed'))).toBe(
        'client-network'
      );
      expect(
        classifyDroppableEvent(exc('AbortError', 'Fetch is aborted'))
      ).toBe('client-network');
    });

    it('ResizeObserver loop completed with undelivered notifications (ENG-853)', () => {
      expect(
        classifyDroppableEvent(
          exc(
            'Error',
            'ResizeObserver loop completed with undelivered notifications.'
          )
        )
      ).toBe('browser-quirk');
    });

    it('ResizeObserver loop limit exceeded (ENG-853)', () => {
      expect(
        classifyDroppableEvent(
          exc('Error', 'ResizeObserver loop limit exceeded')
        )
      ).toBe('browser-quirk');
    });

    it('Safari/Chrome autofill inline-suggestions failure (ENG-853)', () => {
      expect(
        classifyDroppableEvent(exc('Error', 'Failed to get inline suggestions'))
      ).toBe('browser-quirk');
    });

    it('Meta in-app browser postMessage bridge teardown (ENG-853)', () => {
      expect(
        classifyDroppableEvent(
          exc('Error', 'Error invoking postMessage: Java object is gone')
        )
      ).toBe('browser-quirk');
    });
  });

  describe('keeps — these must NOT be swallowed', () => {
    it('a genuine app TypeError', () => {
      expect(
        classifyDroppableEvent(
          exc('TypeError', "Cannot read properties of undefined (reading 'id')")
        )
      ).toBeNull();
    });

    it('a real server 500 surfaced to the client', () => {
      expect(
        classifyDroppableEvent(exc('HTTPError', 'Internal server error'))
      ).toBeNull();
    });

    it('a validation error the user should see reported', () => {
      expect(
        classifyDroppableEvent(exc('HTTPError', 'Service name already exists'))
      ).toBeNull();
    });

    // Guards the narrowness of CLIENT_NETWORK: "failed" alone is not enough.
    it('an unrelated message merely containing "failed"', () => {
      expect(
        classifyDroppableEvent(exc('Error', 'Render failed: template missing'))
      ).toBeNull();
    });

    // Guards the narrowness of the ENG-853 browser-quirk rules: a message that
    // merely mentions the same subsystem is NOT the known noise phrase.
    it('a ResizeObserver-adjacent message that is not the known noise phrase', () => {
      expect(
        classifyDroppableEvent(
          exc('ReferenceError', 'ResizeObserver is not defined')
        )
      ).toBeNull();
    });

    it('a postMessage-adjacent message that is not the known bridge-teardown phrase', () => {
      expect(
        classifyDroppableEvent(
          exc('TypeError', 'Error invoking postMessage: origin mismatch')
        )
      ).toBeNull();
    });

    it('an empty event', () => {
      expect(classifyDroppableEvent({})).toBeNull();
    });
  });
});
