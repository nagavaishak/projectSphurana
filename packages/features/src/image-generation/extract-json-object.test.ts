import { describe, expect, it } from '@borradh-workspace/testing';
import { extractJsonObject } from './extract-json-object.js';

/**
 * The three vision gates all used
 * `text.slice(indexOf('{'), lastIndexOf('}') + 1)`, which breaks the moment a
 * model adds a sentence after the JSON — and every gate treats a parse failure
 * as "no opinion" and ships the graphic. So the failure mode is not a crash, it
 * is the quality gate silently switching itself off for some renders.
 */
describe('extractJsonObject', () => {
  it('takes the object and leaves trailing prose', () => {
    // The production failure: "Unexpected non-whitespace character after JSON".
    const reply =
      '{ "pass": true, "issues": [] }\n\nNothing else looked wrong (to me}';
    expect(extractJsonObject(reply)).toBe('{ "pass": true, "issues": [] }');
  });

  it('ignores braces inside strings', () => {
    // Defect descriptions quote the rendered copy, and rendered copy can
    // contain a brace — a stray `}` from a markdown artefact, for instance.
    const reply =
      '{"issues":[{"detail":"the text reads \\"50% off}\\" here"}]}';
    expect(extractJsonObject(reply)).toBe(reply);
    expect(() => JSON.parse(extractJsonObject(reply) as string)).not.toThrow();
  });

  it('survives an escaped quote before a brace', () => {
    const reply = '{"note":"it says \\"ready\\" }"} trailing';
    expect(JSON.parse(extractJsonObject(reply) as string)).toEqual({
      note: 'it says "ready" }',
    });
  });

  it('handles a fenced reply', () => {
    const reply = '```json\n{ "verdict": "correct" }\n```';
    expect(extractJsonObject(reply)).toBe('{ "verdict": "correct" }');
  });

  it('returns null rather than guessing at a truncated object', () => {
    // A half-written object is not a verdict. Reporting "no opinion" is right;
    // inventing a closing brace would fabricate one.
    expect(extractJsonObject('{ "pass": true, "issues": [')).toBeNull();
  });

  it('returns null when there is no object at all', () => {
    expect(extractJsonObject('I could not assess this image.')).toBeNull();
  });

  it('takes the FIRST object when a reply contains several', () => {
    expect(extractJsonObject('{"a":1} {"b":2}')).toBe('{"a":1}');
  });
});
