'use client';
import { cn } from '@/lib/utils';
import { Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Container } from './container';
import { Heading } from './heading';
import { UserChatIcon } from './illustrations/general';
import { Reveal } from './reveal';

export const FAQs = () => {
  const questions = [
    {
      question: 'What is Borradh?',
      answer:
        'Borradh is your clinic’s AI employee. Her name is Claire. She acquires new patients, manages their bookings, handles all follow-up, collects payments, and keeps patients coming back. You do treatments. Claire does everything else.',
    },
    {
      question: 'Who is Claire for?',
      answer:
        'Any appointment-based clinic that wants more patients without hiring a marketing agency or spending hours on admin. Beauty clinics, medspas, salons, physios, wellness clinics — anyone with a calendar to fill.',
    },
    {
      question: 'How does it work?',
      answer:
        'You connect Claire to your clinic — tell her about your services, staff, and availability. She takes it from there. She runs ads on Meta, responds to every lead on WhatsApp, Instagram, and Messenger, books them into your calendar, collects a deposit, and follows up after. You get a WhatsApp message telling you what happened.',
    },
    {
      question: 'Is there a dashboard I can see everything in?',
      answer:
        'Yes — there’s a full dashboard where you can see everything: every lead, booking, payment, campaign, email and message, all in one place. You don’t have to use it though. Claire keeps you updated on WhatsApp, so you can look at the dashboard as much or as little as you like — she runs everything either way.',
    },
    {
      question: 'What results can I expect?',
      answer:
        'Our clinics typically see 2–3x more bookings within the first month. 90% of clinics that try Claire convert to long-term customers. Claire’s cost per booked appointment is a fraction of what agencies charge.',
    },
  ];
  return (
    <section className="py-16 md:py-24 lg:py-32 relative overflow-hidden">
      <Container>
        <UserChatIcon />
        <Heading className="my-10 md:my-20">Questions</Heading>

        <div className="flex flex-col gap-4">
          {questions.map((question, index) => (
            <Reveal key={question.question} delay={index * 0.08}>
              <Question question={question.question} answer={question.answer} />
            </Reveal>
          ))}
        </div>
      </Container>
    </section>
  );
};

const Question = ({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setOpen(!open)}
      aria-expanded={open}
      // `text-left` on the button, not the children: a button centres its text
      // by default, so anything added in here inherits centring and a question
      // that wraps ends up centred inside a left-aligned card.
      className="w-full rounded-3xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 p-4 md:p-8 text-left"
    >
      <div className="flex items-center justify-between gap-4">
        <h3 className="text-lg md:text-2xl font-bold font-display">
          {question}
        </h3>
        {/* `shrink-0`: without it a question long enough to wrap squeezes the
            circle into an oval. */}
        <div className="size-6 shrink-0 rounded-full relative bg-black dark:bg-white flex items-center justify-center">
          <Minus
            className={cn(
              'size-6 text-white dark:text-black absolute inset-0 transition-all duration-200',
              open && 'scale-0 rotate-90'
            )}
          />
          <Plus
            className={cn(
              'size-6 text-white dark:text-black absolute inset-0 scale-0 -rotate-90 transition-all duration-200',
              open && 'scale-100 rotate-0'
            )}
          />
        </div>
      </div>
      <motion.div
        initial={false}
        animate={{
          height: open ? 'auto' : 0,
          opacity: open ? 1 : 0,
        }}
        exit={{
          height: 0,
          opacity: 0,
        }}
        transition={{
          duration: 0.2,
        }}
        className="overflow-hidden"
      >
        <motion.p
          key={String(open)}
          initial={{
            opacity: 0,
          }}
          animate={{ opacity: 1 }}
          transition={{
            delay: 0.2,
          }}
          className="mt-4 text-neutral-600 dark:text-neutral-200"
        >
          {answer}
        </motion.p>
      </motion.div>
    </button>
  );
};
