import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Check, MessageCircleHeart } from 'lucide-react';
import { motion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { ClaireAvatar } from '@/components/ui/claire-avatar';
import { SpeechBubble } from '@/components/ui/speech-bubble';

const CAPABILITIES = [
  'Plan and launch Meta ad campaigns end-to-end',
  'Triage leads, book appointments, draft replies in your inbox',
  'Generate before-and-after videos from your gallery',
  'Pull weekly summaries — leads, ads, no-shows — in plain English',
];

/**
 * Renders at `/assistant` when the active org is on the free plan.
 *
 * Free orgs still get the corner widget (the bubble in the bottom-right) for
 * support questions — that surface is unchanged. The full Claire workspace
 * is what unlocks on Starter and above.
 *
 * Distinct from `<V3DisabledState />`, which shows for paid orgs that aren't
 * yet on the v3 cohort allowlist.
 */
export function FreeTierGate() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-8 px-4 py-10 text-center">
      <motion.div
        className="flex flex-col items-center gap-5"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
      >
        <ClaireAvatar mood="calm" size="lg" />
        <SpeechBubble
          text="I'm not part of the free plan — I live in Starter and Pro. Upgrade and I'll be here."
          position="above"
          className="max-w-md"
        />
      </motion.div>

      <motion.div
        className="w-full max-w-lg rounded-xl border bg-card p-6 text-left shadow-sm"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15, ease: 'easeOut' }}
      >
        <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          What Claire does once she's in
        </p>
        <ul className="mt-3 grid gap-2.5">
          {CAPABILITIES.map((item) => (
            <li
              key={item}
              className="flex items-start gap-2.5 text-sm leading-snug"
            >
              <Check className="mt-0.5 size-4 flex-none text-primary" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MessageCircleHeart className="size-3.5" />
            Support questions still work in the chat bubble.
          </p>
          <Button asChild>
            <Link to="/billing">
              See plans
              <ArrowUpRight className="ml-1.5 size-3.5" />
            </Link>
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
