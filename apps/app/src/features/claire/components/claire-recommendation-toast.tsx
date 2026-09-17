import type {
  AssistantPrimaryAction,
  AssistantRecommendationKind,
} from '@borradh-workspace/api-client/types';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  Bell,
  CalendarCheck,
  Clock,
  ImagePlus,
  type LucideIcon,
  MessageCircle,
  PartyPopper,
  Send,
  Sparkles,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import {
  useActionRecommendation,
  useActiveRecommendations,
  useDismissRecommendation,
} from '../api';
import { useWalkthroughDispatcher } from '../lib/walkthrough-provider';
import { useClaireWidgetState } from '../lib/widget-state';

// One icon per recommendation kind (claire-owner-spec.md §4.3).
// Unknown kinds fall back to MessageCircle.
//
// Cross-boundary patch (W-C17-usage-dashboard, composer-authorized 2026-04-26):
// W-C16 added 5 new recommendation kinds to `claireRecommendationKindLabels`
// (`no_show_surge`, `offer_expiring_soon`, `cpl_spike`, `creative_burnout`,
// `lead_volume_drop`) but didn't extend this exhaustive Record. Adding the
// 5 icon entries here unblocks `web` typecheck without otherwise touching the
// W-C16 trigger logic.
const RECOMMENDATION_ICON: Record<AssistantRecommendationKind, LucideIcon> = {
  content_no_post_14_days: ImagePlus,
  content_unused_assets: ImagePlus,
  content_learning_phase_prompt: ImagePlus,
  lead_first_of_session: Sparkles,
  lead_unreplied_2h: Clock,
  lead_flagged_problem: AlertTriangle,
  booking_confirmed: PartyPopper,
  pre_appointment_prep: CalendarCheck,
  learning_phase_reassurance: Wand2,
  creative_refresh_needed: Video,
  campaign_learning_phase_exit: Bell,
  prompt_create_first_ad: Sparkles,
  prompt_create_first_offer: Sparkles,
  prompt_record_first_video: Video,
  prompt_create_first_graphic: ImagePlus,
  prompt_create_first_post: ImagePlus,
  // W-C16 lifecycle + performance triggers
  no_show_surge: AlertTriangle,
  offer_expiring_soon: Clock,
  cpl_spike: AlertTriangle,
  creative_burnout: Video,
  lead_volume_drop: AlertTriangle,
  // PRD-1 — Campaign Troubleshooting Framework (proactive trigger).
  campaign_no_leads_4d: AlertTriangle,
  // Window 1 (Claire recommendation engine) — telemetry-only kinds for the
  // ads-new widget + classifier-disagreement surface. Icons are placeholders;
  // these don't currently render via this toast.
  ad_flow_service_pick: Sparkles,
  ad_flow_offer_pick: Sparkles,
  classifier_disagreement: AlertTriangle,
};

/**
 * Floating recommendation toast above the Claire launcher.
 *
 * Renders the single highest-priority active recommendation for the org
 * (claire-owner-spec.md §4.6 — org-wide scope, queued one-at-a-time). Hidden
 * while a tour is running so the tour's Claire chatbox owns the screen
 * (claire-spec-v2.md Decision 6).
 *
 * The `primary_action.type` discriminator picks the Accept behaviour:
 *   - 'navigate' → dispatcher routes to target URL
 *   - 'tour'     → dispatcher hands off to the registered tour handler
 *   - 'none'     → Accept button is hidden; toast is informational only
 *
 * v3 routing change (W-C01-C, claire.md §2 Q11a): clicking the body of the
 * toast (outside X dismiss + Accept button) navigates to `/assistant?prefill=`
 * with the recommendation body preloaded. The inline "Ask a question…" input
 * also navigates to `/assistant?prefill=` instead of opening the mini-panel.
 * The expanded chat surface lives at `/assistant`, not the widget.
 */
export function ClaireRecommendationToast() {
  const [question, setQuestion] = useState('');
  const navigate = useNavigate();
  const isTourRunning = useClaireWidgetState((s) => s.isTourRunning);

  const { recommendations } = useActiveRecommendations();
  const { dismissRecommendation, isDismissing } = useDismissRecommendation();
  const { actionRecommendation, isActioning } = useActionRecommendation();
  const dispatcher = useWalkthroughDispatcher();

  if (isTourRunning) return null;

  // Queue: show only the first active rec. The API orders by priority desc,
  // then createdAt asc — next rec surfaces after mutation invalidates the query.
  const current = recommendations[0];
  if (!current) return null;

  const Icon = RECOMMENDATION_ICON[current.kind] ?? MessageCircle;
  const action = current.primaryAction as AssistantPrimaryAction;
  const showAcceptButton = action.type !== 'none';
  const isBusy = isDismissing || isActioning;

  const handleAccept = () => {
    actionRecommendation(current.id, {
      onSuccess: () => dispatcher.dispatch(action),
    });
  };

  const handleDismiss = () => {
    dismissRecommendation(current.id);
  };

  const handleBodyClick = () => {
    // Body click: open the recommendation in /assistant with its body
    // preloaded as a starter prompt. The user reviews/edits in the composer
    // before sending — we don't auto-submit.
    void navigate({ to: '/assistant', search: { prefill: current.body } });
  };

  const handleAskSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) return;
    void navigate({ to: '/assistant', search: { prefill: trimmed } });
    setQuestion('');
  };

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)]">
      <Alert className="relative pt-10 shadow-lg">
        {/* Dismiss X — TOP-LEFT per spec §4.3 */}
        <button
          type="button"
          onClick={handleDismiss}
          disabled={isBusy}
          aria-label="Dismiss recommendation"
          className={cn(
            'absolute left-2 top-2 inline-flex size-7 items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:pointer-events-none disabled:opacity-50'
          )}
        >
          <X className="size-4" />
        </button>

        <Icon aria-hidden="true" />
        <AlertTitle>{current.title}</AlertTitle>
        <AlertDescription>
          {/* Body click → /assistant?prefill=<body>. The button-as-body keeps
              keyboard + screen-reader semantics; nested buttons (Accept, Send,
              Dismiss) own their own pointer events and won't bubble. */}
          <button
            type="button"
            onClick={handleBodyClick}
            className="block w-full cursor-pointer text-left"
            aria-label="Open this recommendation in Claire"
          >
            {current.body}
          </button>

          {showAcceptButton && (
            <Button
              type="button"
              size="sm"
              onClick={handleAccept}
              disabled={isBusy}
              className="mt-1"
            >
              {action.label}
            </Button>
          )}

          <form
            onSubmit={handleAskSubmit}
            className="mt-2 flex w-full items-center gap-2"
          >
            <Input
              type="text"
              placeholder="Ask a question..."
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              aria-label="Ask Claire a question"
            />
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              aria-label="Send message"
              disabled={!question.trim()}
            >
              <Send className="size-4" />
            </Button>
          </form>
        </AlertDescription>
      </Alert>
    </div>
  );
}
