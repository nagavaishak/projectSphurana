import { describe, expect, it } from '@borradh-workspace/testing';
import { extractFormService, isLeadFormMessage } from './lead-form-message.js';

const REAL_PROD_MESSAGE = `Hello! I filled out your form and would like to know more about your business.
Email: sarahsbowteek@gmail.com
Full name: Sarah Ricketts
How interested are you in our Fat Loss Red Light Therapy?: Very Interested
Phone number: (909) 273-9541`;

describe('isLeadFormMessage', () => {
  it('detects the real prod lead-form message (the bug report)', () => {
    expect(isLeadFormMessage(REAL_PROD_MESSAGE)).toBe(true);
  });

  it('detects the "I submitted your form" phrasing', () => {
    expect(
      isLeadFormMessage('Hi, I just submitted your form about lip filler')
    ).toBe(true);
  });

  it('detects a structured contact dump without the explicit phrase', () => {
    expect(
      isLeadFormMessage(
        'Full name: Jane Doe\nEmail: jane@x.com\nHow interested are you in our Botox?: Very\nPhone number: 0871234567'
      )
    ).toBe(true);
  });

  it('does NOT flag an ordinary treatment question', () => {
    expect(isLeadFormMessage('how much is botox?')).toBe(false);
  });

  it('does NOT flag a message with only an email (no phone/form structure)', () => {
    expect(isLeadFormMessage('you can reach me at jane@example.com')).toBe(
      false
    );
  });

  it('handles empty / null input', () => {
    expect(isLeadFormMessage('')).toBe(false);
    expect(isLeadFormMessage(undefined)).toBe(false);
    expect(isLeadFormMessage(null)).toBe(false);
  });
});

describe('extractFormService', () => {
  it('pulls the service from the interest line', () => {
    expect(extractFormService(REAL_PROD_MESSAGE)).toBe(
      'Fat Loss Red Light Therapy'
    );
  });

  it('strips the leading "our/your/the"', () => {
    expect(
      extractFormService('How interested are you in the CoolSculpting?: Very')
    ).toBe('CoolSculpting');
  });

  it('returns null when there is no interest line', () => {
    expect(extractFormService('how much is botox?')).toBeNull();
    expect(extractFormService(undefined)).toBeNull();
  });
});
