import { describe, expect, it } from '@borradh-workspace/testing';

import {
  FIRST_TOUCH_TEMPLATE_BODY,
  FIRST_TOUCH_TEMPLATE_EXAMPLE,
  FOLLOW_UP_TEMPLATE_BODIES,
  FOLLOW_UP_TEMPLATE_EXAMPLES,
  categoriseTreatment,
  composeFirstTouch,
  composeFollowUp,
  qualifyingQuestion,
} from './compose-first-touch.js';

describe('categoriseTreatment', () => {
  it.each([
    ['Lip Filler', 'injectable'],
    ['Anti-Wrinkle Treatment', 'anti_wrinkle'],
    ['Botox', 'anti_wrinkle'],
    ['Microneedling', 'skin'],
    ['Chemical Peel', 'skin'],
    ['Fat Freezing', 'body'],
    ['Japanese Head Spa', 'low_qualification'],
    ['Swedish Massage', 'low_qualification'],
    ['Microblading', 'semi_permanent_makeup'],
    ['PRP Hair Restoration', 'hair'],
  ] as const)('categorises %s as %s', (name, expected) => {
    expect(categoriseTreatment(name)).toBe(expected);
  });

  it('falls back to unknown with no service', () => {
    expect(categoriseTreatment(null)).toBe('unknown');
    expect(categoriseTreatment('   ')).toBe('unknown');
  });

  // 'Hydrafacial' contains both "facial" (low-qualification) and nothing else;
  // ordering must keep it out of the skin bucket by accident.
  it('prefers the narrower category when keywords overlap', () => {
    expect(categoriseTreatment('Hydrafacial')).toBe('low_qualification');
    expect(categoriseTreatment('Brow Lamination')).toBe('low_qualification');
  });
});

describe('qualifyingQuestion', () => {
  // The whole point of the category split: a head spa has no problem area, and
  // asking what is bothering someone about a relaxation treatment reads as a
  // script nobody proofread.
  it('asks nothing for low-qualification services', () => {
    expect(qualifyingQuestion('low_qualification')).toBeNull();
  });

  it('asks something for every clinical category', () => {
    for (const category of [
      'injectable',
      'anti_wrinkle',
      'skin',
      'body',
      'semi_permanent_makeup',
      'hair',
      'unknown',
    ] as const) {
      expect(qualifyingQuestion(category)).toBeTruthy();
    }
  });
});

describe('composeFirstTouch', () => {
  const base = { firstName: 'Sarah', clinicName: 'Bloom Clinic' };

  it('greets by name and names the clinic', () => {
    const { body } = composeFirstTouch({ ...base, serviceName: 'Lip Filler' });

    expect(body).toContain('Hi Sarah');
    expect(body).toContain('Bloom Clinic');
    expect(body).toContain('the form you submitted');
  });

  it('includes the treatment-matched question', () => {
    const { body } = composeFirstTouch({
      ...base,
      serviceName: 'Microneedling',
    });

    expect(body).toContain('skin concerns');
  });

  it('omits the question for a head spa and offers help instead', () => {
    const { body, category } = composeFirstTouch({
      ...base,
      serviceName: 'Japanese Head Spa',
    });

    expect(category).toBe('low_qualification');
    expect(body).not.toContain('bothering you');
    expect(body).not.toContain('problem area');
    expect(body).toContain('any questions');
  });

  // Every question already ends with its own reason for asking, so appending a
  // generic one said the same thing twice. This reached a real handset as
  // "That way I can give you the best info. That will really help our
  // specialists point you in the right direction with the treatment."
  it('never states the reason for asking twice', () => {
    for (const serviceName of [
      'Lip Filler',
      'Anti Wrinkle',
      'Microneedling',
      'Fat Freezing',
      'Microblading',
      'PRP Hair',
      undefined,
    ]) {
      const { body } = composeFirstTouch({ ...base, serviceName });
      expect(body).not.toContain('point you in the right direction');
    }
  });

  // The head-spa branch is the ONLY one that still needs a line after the
  // greeting, because nothing was asked for an answer to help with.
  it('keeps the offer of help only where no question was asked', () => {
    const asked = composeFirstTouch({ ...base, serviceName: 'Lip Filler' });
    const notAsked = composeFirstTouch({
      ...base,
      serviceName: 'Japanese Head Spa',
    });

    expect(asked.body).not.toContain('Happy to answer');
    expect(notAsked.body).toContain('Happy to answer');
  });

  // Meta rejects a template parameter containing a newline, tab, or 4+ spaces
  // with (#132018), and {{3}} carries this whole block.
  it('keeps the template parameter on one line for every category', () => {
    for (const serviceName of [
      'Lip Filler',
      'Japanese Head Spa',
      'Fat Freezing',
      undefined,
    ]) {
      const { templateParameters } = composeFirstTouch({
        ...base,
        serviceName,
      });
      const tail = templateParameters[2];
      expect(tail).not.toMatch(/[\n\t]/);
      expect(tail).not.toMatch(/ {4}/);
      expect(tail.trim()).toBe(tail);
    }
  });

  it('falls back to a neutral greeting with no first name', () => {
    const { body } = composeFirstTouch({
      firstName: null,
      clinicName: 'Bloom Clinic',
      serviceName: 'Lip Filler',
    });

    expect(body).toContain('Hi there');
  });

  it('uses the generic question when the service is unknown', () => {
    const { body } = composeFirstTouch({ ...base, serviceName: null });

    expect(body).toContain("What's your main concern at the moment?");
  });

  it('exposes template parameters in positional order', () => {
    const { templateParameters } = composeFirstTouch({
      ...base,
      serviceName: 'Microneedling',
    });

    expect(templateParameters[0]).toBe('Sarah');
    expect(templateParameters[1]).toBe('Bloom Clinic');
    expect(templateParameters[2]).toContain('skin concerns');
  });
});

// The approved WhatsApp template and the SMS copy are the same message sent two
// ways. If they drift, a clinic's WhatsApp opener renders differently from the
// SMS fallback of the same first touch — and fixing it costs a re-approval.
describe('FIRST_TOUCH_TEMPLATE_BODY', () => {
  it('has exactly the variables composeFirstTouch supplies', () => {
    const vars = [...FIRST_TOUCH_TEMPLATE_BODY.matchAll(/\{\{(\d+)\}\}/g)].map(
      (m) => m[1]
    );

    expect(vars).toEqual(['1', '2', '3']);
    expect(
      composeFirstTouch({
        firstName: 'Sarah',
        clinicName: 'Bloom Clinic',
        serviceName: 'Microneedling',
      }).templateParameters
    ).toHaveLength(vars.length);
  });

  it('renders identically to the SMS body when the variables are filled', () => {
    const composed = composeFirstTouch({
      firstName: 'Sarah',
      clinicName: 'Bloom Clinic',
      serviceName: 'Microneedling',
    });

    const rendered = composed.templateParameters.reduce<string>(
      (acc, value, i) => acc.replaceAll(`{{${i + 1}}}`, value),
      FIRST_TOUCH_TEMPLATE_BODY
    );

    expect(rendered).toBe(composed.body);
  });

  // The head-spa case has no question, so {{3}} carries only the closing line —
  // one template still has to cover it.
  it('renders identically for a low-qualification service', () => {
    const composed = composeFirstTouch({
      firstName: 'Sarah',
      clinicName: 'Bloom Clinic',
      serviceName: 'Japanese Head Spa',
    });

    const rendered = composed.templateParameters.reduce<string>(
      (acc, value, i) => acc.replaceAll(`{{${i + 1}}}`, value),
      FIRST_TOUCH_TEMPLATE_BODY
    );

    expect(rendered).toBe(composed.body);
  });
});

/**
 * Rules learned from real Meta rejections, not from the docs. Each of these
 * corresponds to a template this repo actually had auto-rejected.
 */
describe('Meta template constraints', () => {
  const vars = (body: string) =>
    new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]));

  const ALL = [
    [
      'claire_first_touch',
      FIRST_TOUCH_TEMPLATE_BODY,
      FIRST_TOUCH_TEMPLATE_EXAMPLE,
    ],
    [
      'claire_follow_up_1',
      FOLLOW_UP_TEMPLATE_BODIES.followup_1,
      FOLLOW_UP_TEMPLATE_EXAMPLES.followup_1,
    ],
    [
      'claire_follow_up_2',
      FOLLOW_UP_TEMPLATE_BODIES.followup_2,
      FOLLOW_UP_TEMPLATE_EXAMPLES.followup_2,
    ],
  ] as const;

  // subcode 2388299 — "Variables can't be at the start or end of the template"
  it.each(ALL)('%s neither starts nor ends with a variable', (_n, body) => {
    expect(body.trimStart().startsWith('{{')).toBe(false);
    expect(body.trimEnd().endsWith('}}')).toBe(false);
  });

  // Established against the live API: the exact opener with {{3}} alone on its
  // line is REJECTED, and the same body with static text joined onto that line
  // passes — deterministically, verified twice. A variable may not be the whole
  // of its line.
  it.each(ALL)('%s never leaves a variable alone on a line', (_n, body) => {
    const lonely = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^(\{\{\d+\}\}\s*)+$/.test(line));
    expect(lonely).toEqual([]);
  });

  // INVALID_FORMAT — a variable template with no example row never reaches a
  // human reviewer.
  it.each(ALL)('%s supplies one example per variable', (_n, body, example) => {
    expect(example.length).toBe(vars(body).size);
    expect(example.every((v) => v.trim().length > 0)).toBe(true);
  });

  // Verified against the live API: an em-dash or an apostrophe contraction in a
  // body this short is enough to flip PENDING to REJECTED. The opener is long
  // enough to carry contractions and does; the nudges avoid both entirely.
  it.each([
    ['claire_follow_up_1', FOLLOW_UP_TEMPLATE_BODIES.followup_1],
    ['claire_follow_up_2', FOLLOW_UP_TEMPLATE_BODIES.followup_2],
  ])('%s uses plain punctuation', (_n, body) => {
    expect(body).not.toContain('—');
    expect(body).not.toMatch(/\w'\w/);
  });

  it.each(ALL)('%s has no em-dash', (_n, body) => {
    expect(body).not.toContain('—');
  });

  // (#132018) — Meta rejects a template PARAMETER containing a newline, a tab,
  // or 4+ consecutive spaces. Found by a real send that failed on exactly this,
  // after the template itself had already been approved.
  it('never puts a newline, tab or run of spaces in a parameter', () => {
    const samples = [
      composeFirstTouch({
        firstName: 'Sarah',
        clinicName: 'Bloom Clinic',
        serviceName: 'Microneedling',
      }),
      composeFirstTouch({
        firstName: 'Sarah',
        clinicName: 'Bloom Clinic',
        serviceName: 'Japanese Head Spa',
      }),
      composeFirstTouch({
        firstName: null,
        clinicName: 'Bloom Clinic',
        serviceName: null,
      }),
      composeFollowUp('followup_1', {
        firstName: 'Sarah',
        clinicName: 'Bloom Clinic',
      }),
      composeFollowUp('followup_2', {
        firstName: 'Sarah',
        clinicName: 'Bloom Clinic',
      }),
    ];
    for (const { templateParameters } of samples) {
      for (const value of templateParameters) {
        expect(value).not.toMatch(/[\n\t]/);
        expect(value).not.toMatch(/ {4}/);
      }
    }
  });

  // subcode 2388293 — "too many variables for its length". Meta enforces a
  // ratio of static text to variables; the nudges carry their copy statically
  // and vary only the name.
  it.each(ALL)('%s keeps enough static text per variable', (_n, body) => {
    const staticChars = body.replace(/\{\{\d+\}\}/g, '').trim().length;
    expect(staticChars / vars(body).size).toBeGreaterThan(30);
  });
});
