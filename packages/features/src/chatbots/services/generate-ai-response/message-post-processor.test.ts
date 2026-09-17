import { describe, expect, it } from '@borradh-workspace/testing';
import { postProcessMessage } from './message-post-processor.js';

describe('postProcessMessage', () => {
  describe('markdown stripping', () => {
    it('converts markdown links to plain URLs', () => {
      const input =
        "Here's the link to book a consultation with us: [Book Now](https://www.borradh.io/book/fifth-avenue) x";
      const result = postProcessMessage(input);
      expect(result).not.toContain('[Book Now]');
      expect(result).toContain('https://www.borradh.io/book/fifth-avenue');
    });

    it('strips bold markdown', () => {
      const input = 'Our **lip filler** treatment is very popular';
      const result = postProcessMessage(input);
      expect(result).toBe('Our lip filler treatment is very popular');
    });

    it('strips italic markdown', () => {
      const input = 'Results are *gorgeous* on most clients';
      const result = postProcessMessage(input);
      expect(result).toBe('Results are gorgeous on most clients');
    });

    it('preserves plain URLs without markdown', () => {
      const input =
        "Here's the link: https://www.borradh.io/book/test any questions let me know x";
      const result = postProcessMessage(input);
      expect(result).toContain('https://www.borradh.io/book/test');
    });
  });

  describe('dash stripping', () => {
    it('replaces em-dashes surrounded by spaces with commas', () => {
      const input = 'The treatment is amazing — you will love it';
      const result = postProcessMessage(input);
      expect(result).toBe('The treatment is amazing, you will love it');
    });

    it('replaces en-dashes surrounded by spaces with commas', () => {
      const input = 'Results are immediate – pretty much right away';
      const result = postProcessMessage(input);
      expect(result).toBe('Results are immediate, pretty much right away');
    });

    it('replaces dashes between words with commas', () => {
      const input = 'The filler—premium quality—lasts 12 months';
      const result = postProcessMessage(input);
      expect(result).toBe('The filler, premium quality, lasts 12 months');
    });

    it('preserves hyphens in compound words', () => {
      const input = 'We offer long-lasting anti-wrinkle treatments';
      const result = postProcessMessage(input);
      expect(result).toBe('We offer long-lasting anti-wrinkle treatments');
    });
  });

  describe('banned phrase removal', () => {
    it('removes "I completely understand"', () => {
      const input =
        'I completely understand your concern. Let me help you with that!';
      const result = postProcessMessage(input);
      expect(result).not.toContain('I completely understand');
    });

    it('removes "That\'s a great question"', () => {
      const input =
        "That's a great question! The treatment takes about 30 minutes.";
      const result = postProcessMessage(input);
      expect(result).not.toContain("That's a great question");
    });

    it('removes "Thank you for reaching out"', () => {
      const input = 'Thank you for reaching out! How can I help?';
      const result = postProcessMessage(input);
      expect(result).not.toContain('Thank you for reaching out');
    });

    it('removes "Feel free to"', () => {
      const input = 'Feel free to ask me anything about the treatment.';
      const result = postProcessMessage(input);
      expect(result).not.toContain('Feel free to');
    });

    it('removes multiple banned phrases from one message', () => {
      const input =
        "Absolutely! That's a great question. I'd be happy to help with that.";
      const result = postProcessMessage(input);
      expect(result).not.toContain('Absolutely!');
      expect(result).not.toContain("That's a great question");
      expect(result).not.toContain("I'd be happy to help");
    });
  });

  describe('hallucination guards', () => {
    it('blocks fake booking confirmations', () => {
      const input =
        "You're booked in for Tuesday at 2pm! See you then. Can't wait!";
      const result = postProcessMessage(input);
      expect(result).not.toContain("You're booked in");
    });

    it('blocks "I\'ve booked you"', () => {
      const input = "I've booked you in for tomorrow at 3pm.";
      const result = postProcessMessage(input);
      expect(result).not.toContain("I've booked you");
    });

    it('blocks "your appointment is confirmed"', () => {
      const input =
        "Your appointment is confirmed for Friday. We'll see you then!";
      const result = postProcessMessage(input);
      expect(result).not.toContain('appointment is confirmed');
    });

    it('blocks "I\'ve cancelled"', () => {
      const input =
        "I've cancelled your appointment. Let me know if you need anything.";
      const result = postProcessMessage(input);
      expect(result).not.toContain("I've cancelled");
    });

    it('blocks a confirmation with the treatment name in the noun phrase', () => {
      // Observed verbatim in local verification: nothing was written, and the
      // pre-existing patterns all missed it because "Botox" sat between
      // "your" and "appointment".
      const result = postProcessMessage(
        'Your Botox appointment is booked for Thursday 3 September at 6pm.'
      );
      expect(result).not.toMatch(/is booked/i);
    });

    it('blocks "you\'re booked for" as well as "booked in"', () => {
      expect(
        postProcessMessage("You're booked for Thursday at 5 PM.")
      ).not.toMatch(/booked for/i);
    });

    it('allows booking confirmations when calendar action is confirmed', () => {
      const input = "You're booked in for Tuesday at 2pm! See you then.";
      const result = postProcessMessage(input, {
        calendarActionConfirmed: true,
      });
      expect(result).toContain("You're booked in");
    });

    // ENG-815 — verbatim from prod conversation d90j7gfxnrp3ekxook9hvf81.
    // Booking is synchronous: there is no state in which one is "being
    // arranged", so a message saying so is as false as "you're booked in",
    // and worse in effect — a customer told it is processing simply waits.
    describe('in-progress and promised-future booking claims (ENG-815)', () => {
      it('blocks "I\'m arranging your haircut ... now"', () => {
        const input =
          "Thanks Pavit, I have your number. I'm arranging your haircut for Thursday 3 September at 2:00 PM now.";
        const result = postProcessMessage(input);
        expect(result).not.toMatch(/arranging/i);
        expect(result).toContain('I have your number');
      });

      it('blocks "I\'m checking that for you now" plus the promised confirmation', () => {
        const input =
          "I'm checking that for you now, Pavit. I'll confirm your haircut for Thursday 3 September at 2:00 PM once it's processed.";
        const result = postProcessMessage(input);
        expect(result).not.toMatch(/checking that for you/i);
        expect(result).not.toMatch(/once it'?s processed/i);
      });

      it('blocks the in-progress claim even when a calendar IS connected', () => {
        // The weaker net (FAKE_AVAILABILITY_PATTERNS) stops running once an
        // org has a resolvable calendar. These claims must not depend on that:
        // having a diary makes Claire more able to check, not more entitled to
        // say she is checking when she is not.
        const result = postProcessMessage("I'm arranging that for you now.", {
          calendarConnected: true,
        });
        expect(result).not.toMatch(/arranging/i);
      });

      it('blocks "I\'m getting you booked in now"', () => {
        const result = postProcessMessage(
          "Great, I'm getting you booked in now."
        );
        expect(result).not.toMatch(/booked in/i);
      });

      it('blocks "I\'ll get that arranged for you"', () => {
        // Observed verbatim in local verification: the booking was correctly
        // refused (org books elsewhere) and the model promised it anyway.
        const result = postProcessMessage(
          "I'll get that arranged for you, Sam."
        );
        expect(result).not.toMatch(/arranged/i);
      });

      it('blocks "I\'ll book you in"', () => {
        const result = postProcessMessage("Lovely, I'll book you in for 6pm.");
        expect(result).not.toMatch(/book you in/i);
      });

      it('blocks "let me get that sorted"', () => {
        const result = postProcessMessage('Let me get that sorted for you.');
        expect(result).not.toMatch(/sorted/i);
      });

      it('leaves the offer form alone — an offer is not a claim', () => {
        // Stripping this would cost bookings; the 2-attempt sales cap is what
        // limits offers, not the hallucination guard.
        const input = 'Shall I get you booked in for Thursday?';
        expect(postProcessMessage(input)).toBe(input);
      });

      it('leaves a promise the bot can actually keep alone', () => {
        const input =
          "I'll let you know about our October offer next time we chat.";
        expect(postProcessMessage(input)).toBe(input);
      });

      it('blocks "your appointment is being processed"', () => {
        const result = postProcessMessage(
          'Your appointment is being processed.'
        );
        expect(result).not.toMatch(/being processed/i);
      });

      it('blocks "I\'ll confirm once it\'s gone through"', () => {
        const result = postProcessMessage(
          "I'll confirm the details once it's gone through."
        );
        expect(result).not.toMatch(/I'll confirm/i);
      });

      it('allows the same language once a real appointment exists', () => {
        const input =
          "You're all booked for Thursday, September 3 at 2:00 PM. I'll confirm the details by email.";
        const result = postProcessMessage(input, {
          calendarActionConfirmed: true,
        });
        expect(result).toContain("You're all booked");
        expect(result).toContain("I'll confirm");
      });

      it('leaves ordinary replies alone', () => {
        const input =
          'Botox is 250 euro and takes about 30 minutes. Was there a day that suits you?';
        expect(postProcessMessage(input)).toBe(input);
      });

      it('does not treat an offer of times as a booking claim', () => {
        const input =
          'I have 10 AM, 2 PM or 5:30 PM on Thursday. Which suits you best?';
        expect(postProcessMessage(input, { calendarConnected: true })).toBe(
          input
        );
      });
    });
  });

  describe('cleanup', () => {
    it('fixes double spaces', () => {
      const input = 'Hello  Sarah, how  are you?';
      const result = postProcessMessage(input);
      expect(result).toBe('Hello Sarah, how are you?');
    });

    it('fixes double commas', () => {
      const input = 'The treatment,, is great';
      const result = postProcessMessage(input);
      expect(result).toBe('The treatment, is great');
    });

    it('trims whitespace', () => {
      const input = '  Hello Sarah!  ';
      const result = postProcessMessage(input);
      expect(result).toBe('Hello Sarah!');
    });
  });

  describe('fake availability guards', () => {
    it('strips "let me check our availability for you" when calendarConnected is false', () => {
      const input =
        'Hey Sarah. Let me check our availability for you. I will get back to you shortly.';
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('check our availability');
    });

    it('strips "let me check the schedule" when calendarConnected is false', () => {
      const input =
        'Hey there. Let me check the schedule for you. One moment please.';
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('check the schedule');
    });

    it('strips "I\'ll find a morning slot for you" when calendarConnected is false', () => {
      const input =
        'No worries. I have a slot on Thursday morning. Would that work?';
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('have a slot');
    });

    it('strips "we have a slot at 10am on Tuesday" when calendarConnected is false', () => {
      const input =
        'Great news. We have a slot at 10am on Tuesday. Shall I book that for you?';
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('have a slot');
    });

    it('strips "we\'ve got a few slots available" when calendarConnected is false', () => {
      const input =
        "Sure thing. We've got a few slots available this week. When suits you best?";
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('got a few slots');
    });

    it('strips "I\'ve noted you down for Tuesday at 10" when calendarConnected is false', () => {
      const input =
        "Perfect. I've noted you down for Tuesday at 10. See you then.";
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('noted you down');
    });

    it('strips "you\'re all set for Monday at 2pm" when calendarConnected is false', () => {
      const input =
        "Lovely. You're all set for Monday at 2pm. We look forward to seeing you.";
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('all set for');
    });

    it('strips "I\'ve pencilled you in" when calendarConnected is false', () => {
      const input =
        "Done. I've pencilled you in for Friday at 3pm. See you soon.";
      const result = postProcessMessage(input, { calendarConnected: false });
      expect(result).not.toContain('pencilled you in');
    });

    it('allows "let me check availability" when calendarConnected is true', () => {
      const input =
        'Hey Sarah. Let me check our availability for you. I will get back to you shortly.';
      const result = postProcessMessage(input, { calendarConnected: true });
      expect(result).toContain('check our availability');
    });

    it('allows "we have a slot at 10am" when calendarConnected is true', () => {
      const input =
        'Great news. We have a slot at 10am on Tuesday. Shall I book that for you?';
      const result = postProcessMessage(input, { calendarConnected: true });
      expect(result).toContain('have a slot');
    });

    it('does not strip availability phrases when calendarConnected is undefined', () => {
      const input =
        'Hey Sarah. Let me check our availability for you. I will get back to you shortly.';
      const result = postProcessMessage(input);
      expect(result).toContain('check our availability');
    });
  });

  describe('sales-cap enforcement', () => {
    it('strips offer-to-send-times when at 2/2 cap', () => {
      const input =
        'I totally understand. Our specialist is experienced and will ensure everything is safe. Would you like me to send you some times we have available?';
      const result = postProcessMessage(input, { bookingPushCount: 2 });
      expect(result).not.toMatch(/would you like me to send/i);
      expect(result).toContain(
        'experienced and will ensure everything is safe'
      );
    });

    it('strips "come in for a chat" when at 2/2 cap', () => {
      const input =
        'Many clients feel the same way initially. Would you like to come in for a chat with our specialist?';
      const result = postProcessMessage(input, { bookingPushCount: 2 });
      expect(result).not.toMatch(/come in for a chat/i);
      expect(result).toContain('Many clients feel the same way');
    });

    it('strips "want me to check what\'s free" when at 2/2 cap', () => {
      const input =
        "Body contouring is €300 and helps sculpt your shape. Want me to check what's free this week?";
      const result = postProcessMessage(input, { bookingPushCount: 2 });
      expect(result).not.toMatch(/want me to check what'?s free/i);
      expect(result).toContain('Body contouring is €300');
    });

    it('allows sales-attempt language when under the cap', () => {
      const input =
        "Body contouring is €300 and helps sculpt your shape. Want me to check what's free this week?";
      const result = postProcessMessage(input, { bookingPushCount: 0 });
      expect(result).toMatch(/want me to check what'?s free/i);
    });

    it('allows sales-attempt language at 1/2 (still under cap)', () => {
      const input =
        'Our specialist gets gorgeous results. Would you like me to send you some times we have available?';
      const result = postProcessMessage(input, { bookingPushCount: 1 });
      expect(result).toMatch(/would you like me to send/i);
    });

    it('strips the booking URL on re-send when link already sent', () => {
      const input =
        "Here's the link to book: https://baysidebeautyclinic.com pick whatever time suits you.";
      const result = postProcessMessage(input, {
        bookingPushCount: 1,
        bookingLinkSent: true,
        bookingLink: 'https://baysidebeautyclinic.com',
      });
      expect(result).not.toContain('https://baysidebeautyclinic.com');
    });

    it('allows the booking URL on first send', () => {
      const input =
        "Here's the link to book: https://baysidebeautyclinic.com pick whatever time suits you.";
      const result = postProcessMessage(input, {
        bookingPushCount: 0,
        bookingLinkSent: false,
        bookingLink: 'https://baysidebeautyclinic.com',
      });
      expect(result).toContain('https://baysidebeautyclinic.com');
    });

    it('regression: body contouring → is it safe → not sure produces zero pushes after turn 1', () => {
      // turn 1: lead asks "body contouring" — Claire pushes (push #1)
      const turn1 =
        "Body contouring is €300. It helps sculpt your shape. Want me to check what's free this week?";
      const result1 = postProcessMessage(turn1, { bookingPushCount: 0 });
      expect(result1).toMatch(/want me to check/i);

      // turn 2: lead asks "is it safe?" — even if LLM tries to push, it's blocked
      // (in this scenario push count is 1 from turn 1, this would be push #2)
      // turn 3: lead says "not sure if its safe" — push count is 2, MUST strip
      const turn3 =
        'I totally understand. Our specialist is experienced and will ensure everything is safe. Would you like to come in for a chat with our specialist?';
      const result3 = postProcessMessage(turn3, { bookingPushCount: 2 });
      expect(result3).not.toMatch(/come in for a chat/i);
      expect(result3).not.toMatch(/would you like to/i);
      // reassurance content survives
      expect(result3).toContain('experienced');
    });

    it('strips the URL even when bookingPushCount is 0 if link was already sent', () => {
      // "I want to book" loop scenario — second send of same link
      const input =
        "Here's the link to book in: https://example.com/book pick a time.";
      const result = postProcessMessage(input, {
        bookingPushCount: 1,
        bookingLinkSent: true,
        bookingLink: 'https://example.com/book',
      });
      expect(result).not.toContain('https://example.com/book');
    });

    it('no-op when no metadata is passed (backwards compatibility)', () => {
      const input =
        "Body contouring is €300. Want me to check what's free this week?";
      const result = postProcessMessage(input);
      expect(result).toContain('Want me to check');
    });
  });

  describe('passthrough', () => {
    it('passes through clean messages unchanged', () => {
      const input =
        'Heyyy Sarah! The lip filler is €250 and the results are gorgeous 😍 Would you like me to check availability? x';
      const result = postProcessMessage(input);
      expect(result).toBe(input);
    });

    it('handles empty strings', () => {
      expect(postProcessMessage('')).toBe('');
    });

    it('handles whitespace-only strings', () => {
      expect(postProcessMessage('   ')).toBe('   ');
    });
  });
});
