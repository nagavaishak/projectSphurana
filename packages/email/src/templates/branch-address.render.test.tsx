import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';
import { AppointmentReminderEmail } from './AppointmentReminderEmail.js';
import { AppointmentRescheduleEmail } from './AppointmentRescheduleEmail.js';
import { BookingConfirmationEmail } from './BookingConfirmationEmail.js';

/**
 * RENDERED-OUTPUT tests for the branch address on the three customer-facing
 * appointment emails.
 *
 * WHY RENDERED, not prop-level. `organizationAddress` was DECLARED and RENDERED
 * on `BookingConfirmationEmail` for months with zero producers anywhere in the
 * codebase — a prop-level assertion would have passed the whole time. What has
 * to be true is that the branch's address reaches the HTML a patient opens.
 *
 * WHY THE NEGATIVE CASE MATTERS MORE THAN THE POSITIVE. An appointment with no
 * branch on file — every row predating the location backfill — must render NO
 * location line. The failure mode these tests exist to prevent is not a missing
 * address; it is the WRONG one. Sending a Cork patient to the Dublin clinic is
 * strictly worse than telling them nothing, so "absent" is the required
 * degradation and is asserted as such: the word "Location:" must not appear at
 * all, and neither may any other branch's address.
 */

const CORK = 'Unit 4, South Mall, Cork, T12 XY45';
const DUBLIN = '12 Main Street, Dublin 2';

const confirmationProps = {
  leadName: 'Sarah',
  serviceName: 'Lip Filler Consultation',
  formattedDate: 'Monday, 15 March 2026',
  formattedTime: '10:00 AM',
  appointmentDuration: 30,
  organizationName: 'Glow Aesthetics',
};

const reminderProps = {
  leadName: 'Sarah',
  appointmentTitle: 'Lip Filler Consultation',
  formattedDate: 'Monday, 15 March 2026',
  formattedTime: '10:00 AM',
  timeUntil: '24 hours',
  organizationName: 'Glow Aesthetics',
};

const rescheduleProps = {
  leadName: 'Sarah',
  appointmentTitle: 'Lip Filler Consultation',
  oldFormattedDate: 'Monday, 15 March 2026',
  oldFormattedTime: '10:00 AM',
  newFormattedDate: 'Tuesday, 16 March 2026',
  newFormattedTime: '11:00 AM',
  organizationName: 'Glow Aesthetics',
};

describe('BookingConfirmationEmail — branch address', () => {
  it('renders the branch the customer booked, not the org', async () => {
    const html = await render(
      <BookingConfirmationEmail
        {...confirmationProps}
        organizationAddress={CORK}
      />
    );

    expect(html).toContain('Unit 4, South Mall, Cork, T12 XY45');
    expect(html).not.toContain(DUBLIN);
  });

  it('omits the location line entirely when the booking has no branch', async () => {
    const html = await render(
      <BookingConfirmationEmail {...confirmationProps} />
    );

    expect(html).not.toContain('Location:');
    expect(html).not.toContain(CORK);
    expect(html).not.toContain(DUBLIN);
    // Still a usable email — the rest of the booking is intact.
    expect(html).toContain('Lip Filler Consultation');
  });
});

describe('AppointmentReminderEmail — branch address', () => {
  it('renders the branch the appointment is at', async () => {
    const html = await render(
      <AppointmentReminderEmail {...reminderProps} organizationAddress={CORK} />
    );

    expect(html).toContain('Unit 4, South Mall, Cork, T12 XY45');
    expect(html).not.toContain(DUBLIN);
  });

  it('omits the location line entirely for a NULL-branch appointment', async () => {
    const html = await render(<AppointmentReminderEmail {...reminderProps} />);

    expect(html).not.toContain('Location:');
    expect(html).not.toContain(CORK);
    expect(html).not.toContain(DUBLIN);
    expect(html).toContain('Lip Filler Consultation');
  });
});

describe('AppointmentRescheduleEmail — branch address', () => {
  it('renders the branch the appointment is at', async () => {
    const html = await render(
      <AppointmentRescheduleEmail
        {...rescheduleProps}
        organizationAddress={CORK}
      />
    );

    expect(html).toContain('Unit 4, South Mall, Cork, T12 XY45');
    expect(html).not.toContain(DUBLIN);
  });

  it('omits the location line entirely for a NULL-branch appointment', async () => {
    const html = await render(
      <AppointmentRescheduleEmail {...rescheduleProps} />
    );

    expect(html).not.toContain('Location:');
    expect(html).not.toContain(CORK);
    expect(html).not.toContain(DUBLIN);
    expect(html).toContain('Lip Filler Consultation');
  });
});
