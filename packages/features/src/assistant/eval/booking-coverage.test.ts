import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { manageAppointmentsSkill } from '../skills/manage-appointments.skill.js';
import { manageServicesSkill } from '../skills/manage-services.skill.js';

/**
 * Booking-coverage drift gate (fresha-clone), features side.
 *
 * Companion to `apps/api/.../appointments/status-coverage.spec.ts` (which
 * gates the tool/enum side). This half gates the SKILL PROMPT + eval fixtures —
 * the two surfaces that silently drifted before: the manage-services prompt
 * once claimed "pricing is informational only" while the tools took structured
 * prices, and there was no eval fixture for reschedule / cancel / deposit /
 * no-show at all.
 *
 * If a booking capability is removed from a skill's prompt or its fixture is
 * deleted, this fails — keeping the prompt, tools, and fixtures honest together.
 */

const RECORDINGS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  'recordings'
);

function allRecordingText(): string {
  const files = readdirSync(RECORDINGS_DIR).filter((f) => f.endsWith('.json'));
  return files
    .map((f) => readFileSync(join(RECORDINGS_DIR, f), 'utf8'))
    .join('\n');
}

describe('drift gate: manage-appointments skill prompt', () => {
  const prompt = manageAppointmentsSkill.promptFragment.toLowerCase();

  it.each([
    ['no-show', 'no-show'],
    ['deposit', 'deposit'],
    ['double-book', 'double-book'],
    ['fee', 'fee'],
    ['setAppointmentStatus', 'setappointmentstatus'],
    ['markNoShow', 'marknoshow'],
  ])('mentions %s', (_label, needle) => {
    expect(prompt).toContain(needle);
  });

  it('lists the no-show and status tools in toolNames', () => {
    expect(manageAppointmentsSkill.toolNames).toContain('markNoShow');
    expect(manageAppointmentsSkill.toolNames).toContain('setAppointmentStatus');
  });

  // Resource scheduling added a FIFTH reason a slot can be missing. The prompt
  // is where Claire learns to look for it, and a prompt still teaching four
  // sources is how a correct capability turns into a confident wrong answer:
  // rota, hours, blocks and leave all clean, and "nothing is blocking this
  // slot" while both treatment rooms are taken.
  it.each([
    ['the fifth source', 'room or machine'],
    ['the blocker kind', 'no_free_resource'],
    ['how to enable the check', 'serviceid'],
    ['the not-applicable case', 'resources.applies'],
  ])('teaches %s', (_label, needle) => {
    expect(prompt).toContain(needle);
  });

  it('no longer claims there are only four causes', () => {
    expect(prompt).not.toContain('the four things that can cause it');
  });
});

describe('drift gate: manage-services skill prompt (structured pricing)', () => {
  const prompt = manageServicesSkill.promptFragment.toLowerCase();

  // The stale prompt said pricing was "informational only". Guard the fixed →
  // the prompt must describe the structured price types + variants + deposits.
  it.each(['fixed', 'from', 'free', 'poa', 'variant', 'deposit', 'pricecents'])(
    'mentions structured-pricing term "%s"',
    (needle) => {
      expect(prompt).toContain(needle);
    }
  );

  it('no longer claims pricing is "informational only"', () => {
    expect(prompt).not.toContain('informational only');
  });
});

describe('drift gate: eval fixtures exercise the new booking flows', () => {
  const recordings = allRecordingText();

  // Every fresha booking action Claire performs must have at least one recorded
  // fixture, so a regression in that flow is caught by the replay eval.
  it.each([
    'book_appointment',
    'reschedule_appointment',
    'cancel_appointment',
    'mark_no_show',
    'create_service',
  ])('has a recording exercising the %s action', (action) => {
    expect(recordings).toContain(`"${action}"`);
  });

  // `no_show` and `arrived` show up as concrete status values in tool
  // results; `cancelled` is covered by the `cancel_appointment` action above
  // (its recorded result is a confirmation presentation, not a status field).
  it.each(['no_show', 'arrived'])(
    'has a recording exercising the %s appointment status',
    (status) => {
      expect(recordings).toContain(`"${status}"`);
    }
  );
});
