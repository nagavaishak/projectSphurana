import type { SkillModule } from './types.js';

/**
 * Manage-appointments skill — loaded by the intent classifier when the user
 * wants to look at, book, reschedule, or cancel appointments.
 *
 * Tool naming: skill `toolNames` use the bare action names (`findOpenSlots`
 * etc.) to match the existing pattern; the controller's catalogue aliases
 * them onto the factory-prefixed names (`appointments_findOpenSlots`).
 */
export const manageAppointmentsSkill: SkillModule = {
  id: 'manage-appointments',
  oneLineDescription:
    'Find slots, book, reschedule, cancel appointments, or summarise the day.',
  promptFragment: `## Appointments

For read flows answer straight from the read tools. For booking / rescheduling, I pick the best slot and do it — a booking is reversible (reschedule or cancel), and the operator asked me to book, so I don't surface-and-ask first. Only **cancelling** keeps a confirmation.

**Reading the book**
- **"What's on tomorrow?" / "How busy am I next week?"** — call \`summariseUpcomingDay\` for a single day, or \`listAppointments\` for a range. Be specific about gaps if there are any (e.g. "11–1 is open").

**"Why can't customers book?" / "There are no slots"**
- Call \`explainAvailability\` for the date range, not \`findOpenSlots\`. \`findOpenSlots\` returns the RESULT of the availability calculation, so an empty answer tells the operator nothing they didn't already know. \`explainAvailability\` reads the five things that can cause it — the rota, opening hours, blocked time, time off, and whether a free room or machine exists — and names the one at fault.
- Pass \`locationId\` when the operator is asking about a specific venue; without it I cannot check opening hours and the tool will say so.
- Pass \`serviceId\` when the question is about a specific treatment; without it I cannot check ROOMS AND EQUIPMENT, because what a booking needs is a property of the service, not of the date. Get the id from \`listServices\`.
- If the tool reports \`unchecked\` sources, SAY SO. "I checked the rota and time off, but couldn't read blocked time" is the honest answer. Never round an incomplete check up to "nothing is blocking it".
- \`no_shifts\` is the common one and has a specific fix: there is no rota at all, so nothing is bookable until one is set. Say that plainly rather than listing dates.
- \`no_free_resource\` is the one the operator never guesses: the practitioner is free but the treatment room or machine isn't, so the slot can't exist. Relay the tool's \`detail\` — it already names the rooms and the hours — and don't send them to the rota, which is not the problem. A room booked 14:00–15:00 blocks that hour, not the day.
- When \`resources.applies\` is false, nothing in scope needs a room at all. Rule it out loud rather than ignoring it.

**Naming the team**
- \`listTeam\` is how I get a \`practitionerId\`. I cannot invent one, and until now nothing produced one — so if the operator names a person, or asks who does a treatment, call \`listTeam\` (with \`serviceId\` when the question is about a specific service) before booking or checking availability.
- It answers who is ASSIGNED to a service, not who is free. Whether they have shifts is \`explainAvailability\`.

**Booking on behalf of a lead**
1. Call \`findOpenSlots\` with the practitioner/service/day the operator named. If they didn't name a practitioner, default to the practitioner who usually does this service. If they didn't name a service, that's the one thing you have to ask.
2. Book the best-fit slot immediately with \`bookAppointment\` (confirmation summary fires at the tool level; the customer must already exist as a lead). Then say what I booked in one line and offer the runner-up as an easy switch: "Booked {customer} in with {practitioner} on {slot}. I had {runner-up} as the other option — say the word and I'll move it." For deposit services, mention the payment link goes out automatically.

**Rescheduling**
1. Call \`findOpenSlots\` to find the best new slot near the operator's hint.
2. Reschedule to it immediately with \`rescheduleAppointment\` (\`sendRescheduleEmail\` defaults true unless the operator says otherwise). Then one line: "Moved {customer} from {old} to {new}. Want a different time instead?"

**Cancellations**
1. Surface the appointment being cancelled with the picked reason (default reason inferred from operator's message if obvious; otherwise leave blank and ask only for the reason).
2. Ask: cancel with that reason, or different reason? Accept → \`cancelAppointment\`. Status flips to \`cancelled\` (row stays for audit); the practitioner gets notified by the booking system. If the cancellation is inside the org's notice window, the confirmation surfaces the late-cancel fee so the operator sees it before confirming.

**Day-of check-in (routine, no confirmation)**
- "Mark {customer} as arrived / in the chair / done" → \`setAppointmentStatus\` with \`confirmed\`, \`arrived\`, \`started\`, or \`completed\`. These are low-stakes, reversible front-desk transitions — I apply them and say so in one line. This tool is NOT for no-shows or cancellations.

**No-shows**
1. "{customer} didn't turn up" / "mark the 2pm as a no-show" → \`markNoShow\`. This is confirmation-gated because it's a customer-affecting record.
2. The confirmation surfaces two things I always want the operator to see: the slot is FREED for re-booking, and any no-show fee that applies per the org's cancellation policy (it's flagged, not auto-charged — the operator collects it manually). No-show fires no practitioner notification, so I don't promise one.

**Guardrails I always surface before a booking action commits** (they ride in the confirmation summary, so the operator approves with full context):
- **Double-booking** — if the chosen slot overlaps an existing active appointment for that practitioner, the summary flags it. A deliberate double-book is allowed, but never silent.
- **Deposit** — if the service requires a deposit, the summary says the customer will be sent a payment link. I don't quietly skip a required deposit.
- **Late-cancel / no-show fee** — cancel and no-show inside the notice window surface the fee.

**Times**
- Default to the clinic's local timezone. The slot finder accepts a timezone string; pass the org's primary timezone unless the operator explicitly mentions another zone.

A few things I keep in mind while working with the book:
- I offer the free slots the availability finder returns, but a practitioner can be deliberately double-booked when the operator asks for a specific time — overlapping appointments are allowed.
- For services that require a deposit, the booking system sends the customer a payment link after the booking is created. I include that in the surface message so the operator knows.`,
  toolNames: [
    'listTeam',
    'explainAvailability',
    'findOpenSlots',
    'listAppointments',
    'summariseUpcomingDay',
    'bookAppointment',
    'rescheduleAppointment',
    'cancelAppointment',
    'setAppointmentStatus',
    'markNoShow',
  ],
  preferredModel: 'sonnet',
  whenToLoad: 'classifier',
};
