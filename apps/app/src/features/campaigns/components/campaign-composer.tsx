'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useListWhatsAppAccounts } from '@/features/integrations/api';
import { CreateLeadDialog } from '@/features/leads/components/create-lead-dialog';
import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import {
  fillWhatsappTemplate,
  resolveCampaignWhatsappTemplate,
} from '@borradh-workspace/api-client';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ClockIcon,
  MailIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  PenLineIcon,
  SendIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  UserIcon,
  UserPlusIcon,
  UsersIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type CampaignChannel,
  type CampaignMessage,
  type SampleRecipientsInput,
  type SegmentFilter,
  campaignChannelLabels,
  useEnsureWhatsappTemplate,
  useListSegments,
  useSampleRecipients,
  useSegmentReach,
  useSendCampaign,
  useSmsNumber,
  useUpsertCampaignMessage,
  useWhatsappTemplates,
} from '../api';
import { sendCampaignForm } from '../api/send-campaign';
import type { Segment } from '../api/types';
import { ENABLED_CHANNELS, isChannelEnabled } from '../channels';
import { CampaignPreviewPane } from './preview';
import { SegmentBuilder } from './segment-builder';

/**
 * Labels come from the form declaration, not from literals here. The form
 * contract locates each control by the same string, so the label a user reads
 * and the label the contract test looks for cannot drift apart.
 */
const L = sendCampaignForm.labels;

/**
 * The one campaign composer — used for BOTH creating a new bulk message and
 * editing an existing draft. A two-column screen: controls on the left, a live
 * WYSIWYG preview on the right (they stack on mobile). Per-channel compose is
 * deliberately symmetrical — email and WhatsApp each get a Subject/Message +
 * "Write with AI" card — so there is nothing new to learn between them.
 *
 * Everything that used to be a separate entity to assemble — segment, campaign,
 * per-channel messages — is created behind the single Send action with smart
 * defaults. Channels are auto-included wherever the audience is reachable AND
 * the org can deliver (email always; WhatsApp needs a connected account);
 * undeliverable channels surface as a quiet setup link, never a blocker.
 */

const CHANNEL_ICON: Record<CampaignChannel, typeof MailIcon> = {
  email: MailIcon,
  sms: MessageSquareIcon,
  whatsapp: MessageCircleIcon,
};

interface AudienceOption {
  key: string;
  label: string;
  filter: SegmentFilter;
  /** Set for saved segments — reused at send time instead of creating one. */
  segmentId?: string;
}

function audiencePresets(): AudienceOption[] {
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  return [
    { key: 'everyone', label: 'Everyone', filter: {} },
    { key: 'new', label: 'New leads', filter: { status: ['new'] } },
    {
      key: 'quiet',
      label: 'Quiet for 30+ days',
      filter: { lastContactedBefore: thirtyDaysAgo },
    },
  ];
}

/**
 * Resolve merge fields to their fallbacks ("there", not a sample name) — used
 * for the auto-suggested subject, which is sent literally to everyone.
 */
function renderFallback(text: string): string {
  return text.replace(
    /\{\{\s*\w+\s*(?:\|\s*([^}]*?)\s*)?\}\}/g,
    (_m, fallback?: string) => fallback ?? ''
  );
}

/**
 * Suggest an email subject from the message. Greetings and leading merge
 * fields make useless subjects ("there, …"), so start at the first real
 * sentence, stop at its end, and never cut mid-word.
 */
function suggestSubject(body: string): string {
  const withoutGreeting = body.replace(
    /^\s*(?:hi|hey|hello|dear)?\s*(?:\{\{[^}]*\}\})?\s*[,!.:;–—-]*\s*/i,
    ''
  );
  const firstLine =
    renderFallback(withoutGreeting)
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine;
  const capped = sentence.split(/\s+/).slice(0, 10).join(' ');
  const clipped =
    capped.length > 80 ? capped.slice(0, 80).replace(/\s+\S*$/, '') : capped;
  const cleaned = clipped.replace(/[,:;.–—-]+$/, '').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** The `{{2}}` message value stored in an existing WhatsApp message, if any. */
function initialWhatsappMessage(messages?: CampaignMessage[]): string {
  const m = messages?.find((x) => x.channel === 'whatsapp');
  // params are ordered [{{1}}=firstName token, {{2}}=message]; {{2}} is index 1.
  return m?.whatsappTemplateParams?.[1] ?? '';
}

export interface CampaignComposerProps {
  /**
   * EDIT MODE. When set, the composer prefills from {@link initialMessages} and
   * saves via the message-upsert path (`POST campaigns/:id/messages`) instead of
   * creating + launching a brand-new campaign. Unset ⇒ CREATE MODE.
   */
  campaignId?: string;
  /** The campaign's existing per-channel messages (edit mode prefill). */
  initialMessages?: CampaignMessage[];
  /** Called after a successful edit-mode save (create mode navigates itself). */
  onSaved?: () => void;
}

export function CampaignComposer({
  campaignId,
  initialMessages,
  onSaved,
}: CampaignComposerProps = {}) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const presets = useMemo(audiencePresets, []);
  const isEdit = !!campaignId;

  const initialEmail = useMemo(
    () => initialMessages?.find((m) => m.channel === 'email'),
    [initialMessages]
  );

  // ── Who ───────────────────────────────────────────────────────────────────
  const [audience, setAudience] = useState<AudienceOption>(presets[0]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const { segments } = useListSegments();
  // Every send auto-creates a "<preset> — <date>" segment; showing those back
  // as chips buries the row in near-duplicates. Only audiences someone chose
  // to build and name belong in the picker.
  const AUTO_SEGMENT_NAME = /—\s*\d{1,2}\s+\S+\s+\d{4}$/;
  const savedOptions: AudienceOption[] = segments
    .filter((s) => !AUTO_SEGMENT_NAME.test(s.name))
    .slice(0, 4)
    .map((s) => ({
      key: `saved-${s.id}`,
      label: s.name,
      filter: (s.filterJson ?? {}) as SegmentFilter,
      segmentId: s.id,
    }));
  // Reach is a query keyed under ['leads', …], so creating or importing leads
  // anywhere in the app refreshes the count automatically.
  const { reach: preview, isLoading: isPreviewing } = useSegmentReach(
    audience.filter
  );

  const onSegmentCreated = (s: Segment) => {
    setBuilderOpen(false);
    setAudience({
      key: `saved-${s.id}`,
      label: s.name,
      filter: (s.filterJson ?? {}) as SegmentFilter,
      segmentId: s.id,
    });
  };

  // ── What (email) ────────────────────────────────────────────────────────
  const [body, setBody] = useState(() => initialEmail?.body ?? '');
  const [subject, setSubject] = useState(() => initialEmail?.subject ?? '');
  // In edit mode the loaded subject is the user's own — never auto-overwrite it.
  const [subjectTouched, setSubjectTouched] = useState(isEdit);
  const [emailPrompt, setEmailPrompt] = useState('');
  // ── What (WhatsApp — the canonical template's {{2}} message) ──────────────
  const [waMessage, setWaMessage] = useState(() =>
    initialWhatsappMessage(initialMessages)
  );
  const [waPrompt, setWaPrompt] = useState('');
  // One channel drafts at a time; null when idle.
  const [draftingChannel, setDraftingChannel] =
    useState<CampaignChannel | null>(null);

  // Auto-suggest the subject from the message until the user edits it (create
  // mode only; `subjectTouched` starts true in edit).
  useEffect(() => {
    if (subjectTouched) return;
    setSubject(suggestSubject(body));
  }, [body, subjectTouched]);

  /**
   * Stream a draft from the shared SSE endpoint into the given field. Used by
   * both the Email and the WhatsApp cards (same route, different `channel`).
   */
  async function draftWithAI(
    channel: CampaignChannel,
    prompt: string,
    onReset: () => void,
    onToken: (token: string) => void
  ) {
    if (!prompt.trim() || draftingChannel) return;
    setDraftingChannel(channel);
    onReset();
    try {
      // Bearer, not just the cookie: `AuthGuard` falls back to a `__Secure-`
      // prefixed cookie, which never reaches this SSE call from the SPA and
      // does not exist at all on native (Capacitor has no cookie jar). Without
      // the header the request 401s before any drafting happens — the same
      // token `apiClient` attaches to every other request.
      const token = getAuthToken();
      const res = await fetch(resolveApiUrl('campaigns/draft-content/stream'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({ channel, prompt }),
      });
      if (!res.ok) throw new Error(`draft request failed: ${res.status}`);
      if (!res.body) throw new Error('no stream');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim();
          if (!line || line === '[DONE]') continue;
          try {
            const obj = JSON.parse(line) as { token?: string };
            if (obj.token) onToken(obj.token);
          } catch {
            /* partial frame — ignore */
          }
        }
      }
    } catch {
      toast.error('Drafting failed. Try again.');
    } finally {
      setDraftingChannel(null);
    }
  }

  // ── Channels (auto in create; from the campaign in edit) ──────────────────
  const { smsNumber } = useSmsNumber();
  const { accounts: waAccounts } = useListWhatsAppAccounts({});
  const [excluded, setExcluded] = useState<Set<CampaignChannel>>(new Set());

  const deliverable: Record<CampaignChannel, boolean> = {
    email: true,
    sms: smsNumber?.status === 'active',
    whatsapp: waAccounts.some((a) => a.isActive),
  };
  const reachable = (c: CampaignChannel) => preview?.channels?.[c] ?? 0;
  // In edit mode the channel set is fixed by the campaign's existing messages;
  // in create mode it is auto-derived from reach + deliverability.
  const editChannels = useMemo(
    () =>
      ENABLED_CHANNELS.filter((c) =>
        (initialMessages ?? []).some((m) => m.channel === c)
      ),
    [initialMessages]
  );
  const autoChannels = isEdit
    ? editChannels
    : ENABLED_CHANNELS.filter((c) => reachable(c) > 0 && deliverable[c]);
  const activeChannels = autoChannels.filter((c) => !excluded.has(c));
  // Only nudge setup for channels actually on offer, or a disabled channel
  // would advertise a setup flow that leads nowhere.
  const needsSetup = (['sms', 'whatsapp'] as CampaignChannel[]).filter(
    (c) => !isEdit && isChannelEnabled(c) && reachable(c) > 0 && !deliverable[c]
  );

  const toggleChannel = (c: CampaignChannel) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      next.has(c) ? next.delete(c) : next.add(c);
      return next;
    });

  const emailActive = activeChannels.includes('email');
  const whatsappActive = activeChannels.includes('whatsapp');

  // ── WhatsApp: the org's canonical, pre-approved Meta template ─────────────
  // Bulk WhatsApp is business-initiated, so it can only send a pre-approved
  // Meta template. The everyday flow standardises on ONE template
  // (`borradh_campaign_message`): {{1}} auto-binds to the recipient's first
  // name and {{2}} is the message the user writes. No raw template picker.
  const { templates: waTemplates } = useWhatsappTemplates(
    deliverable.whatsapp || isEdit
  );
  const resolved = resolveCampaignWhatsappTemplate(waTemplates);
  const waApproved = resolved?.template.status === 'approved';
  const {
    ensureTemplate,
    isEnsuring,
    status: ensureStatus,
  } = useEnsureWhatsappTemplate();
  // No canonical/approved template yet — offer the one-click setup path.
  const showWaSetup =
    !resolved && ensureStatus !== 'created' && ensureStatus !== 'pending';
  // The template exists but Meta hasn't approved it yet (up to 24h).
  const showWaPending =
    (!!resolved && !waApproved) ||
    ensureStatus === 'created' ||
    ensureStatus === 'pending';

  /** Build the WhatsApp send intent: {{1}}=firstName token, {{2}}=message. */
  const buildWhatsappIntent = () => {
    if (!resolved) return undefined;
    const valuesByIndex: Record<number, string> = {};
    if (resolved.firstNameParamIndex != null) {
      valuesByIndex[resolved.firstNameParamIndex] = '{{firstName|there}}';
    }
    const messageIndex = resolved.editableParamIndices[0];
    if (messageIndex != null) valuesByIndex[messageIndex] = waMessage;
    const indices = [
      ...(resolved.firstNameParamIndex != null
        ? [resolved.firstNameParamIndex]
        : []),
      ...resolved.editableParamIndices,
    ].sort((a, b) => a - b);
    const params = indices.map((i) => valuesByIndex[i] ?? '');
    return {
      id: resolved.template.id,
      params,
      body: fillWhatsappTemplate(resolved.template.body, valuesByIndex),
    };
  };

  // ── Readiness ─────────────────────────────────────────────────────────────
  const reachableTotal = preview?.reachable ?? 0;
  const noAudience = !isEdit && !isPreviewing && reachableTotal === 0;
  // Email is the only channel with a free-text body + subject to fill in.
  const emailReady =
    !emailActive || (body.trim().length > 0 && subject.trim().length > 0);
  // WhatsApp needs an approved template AND a written message; a pending
  // template blocks WhatsApp (but not email — the user can turn WhatsApp off).
  const waReady =
    !whatsappActive || (waApproved && waMessage.trim().length > 0);

  const canSend =
    !isEdit &&
    emailReady &&
    waReady &&
    reachableTotal > 0 &&
    activeChannels.length > 0;
  const canSave = isEdit && emailReady && waReady && activeChannels.length > 0;

  // ── Live preview ──────────────────────────────────────────────────────────
  // Page through REAL eligible recipients (their first name + merge fields) for
  // the selected audience; falls back to a generic sample when empty / in edit.
  const primaryChannel = activeChannels[0];
  const sampleInput: SampleRecipientsInput | null =
    !isEdit && primaryChannel
      ? { filterJson: audience.filter, channel: primaryChannel, limit: 10 }
      : null;
  const { recipients: previewRecipients } = useSampleRecipients(sampleInput);

  // ── Send (create) / Save (edit) ───────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { sendCampaign, isSending } = useSendCampaign({
    onSuccess: (campaign) =>
      navigate({
        to: routes.campaignDetail(campaign.id),
      }),
    onError: () => setConfirmOpen(false),
  });

  const { saveMessageAsync } = useUpsertCampaignMessage(campaignId ?? '', {
    silent: true,
  });
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  async function handleSaveEdit() {
    if (!canSave || isSavingEdit) return;
    setIsSavingEdit(true);
    try {
      for (const channel of activeChannels) {
        if (channel === 'whatsapp') {
          const intent = buildWhatsappIntent();
          if (!intent) continue;
          await saveMessageAsync({
            channel,
            body: intent.body,
            whatsappTemplateId: intent.id,
            whatsappTemplateParams: intent.params,
          });
        } else {
          await saveMessageAsync({ channel, subject, body });
        }
      }
      toast.success('Changes saved');
      onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to save changes');
    } finally {
      setIsSavingEdit(false);
    }
  }

  const previewPane =
    activeChannels.length > 0 ? (
      <CampaignPreviewPane
        channels={activeChannels}
        subject={subject}
        body={body}
        whatsappMessage={waMessage}
        recipients={previewRecipients}
      />
    ) : (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Pick an audience and a channel to see a live preview.
      </p>
    );

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-2">
      {/* ── Controls ─────────────────────────────────────────────────────── */}
      <div className="space-y-6">
        {/* Who (create only — an edit is bound to the campaign's audience) */}
        {!isEdit && (
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <UsersIcon className="size-4 text-muted-foreground" />
              {L.audience}
            </Label>
            <div className="flex flex-wrap gap-2">
              {[...presets, ...savedOptions].map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setAudience(p)}
                  className={cn(
                    'rounded-full border px-4 py-1.5 text-sm transition-colors',
                    audience.key === p.key
                      ? 'border-primary bg-primary font-medium text-primary-foreground shadow-sm'
                      : 'hover:bg-muted'
                  )}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setBuilderOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-dashed px-4 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <SlidersHorizontalIcon className="size-3.5" />
                More options
              </button>
            </div>
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <UsersIcon className="size-3.5" />
              {isPreviewing ? (
                <Skeleton className="h-4 w-24" />
              ) : (
                <>
                  {reachableTotal} reachable{' '}
                  {reachableTotal === 1 ? 'person' : 'people'}
                </>
              )}
            </p>
            {noAudience && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
                <span className="text-sm text-muted-foreground">
                  No one to send to yet.
                </span>
                <CreateLeadDialog
                  trigger={
                    <Button type="button" size="sm" variant="outline">
                      <UserPlusIcon className="size-4" />
                      Add a lead
                    </Button>
                  }
                />
                <Button type="button" size="sm" variant="ghost" asChild>
                  <Link to={routes.customers}>Go to Clients</Link>
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Channels — auto, quiet */}
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {autoChannels.map((c) => {
              const Icon = CHANNEL_ICON[c];
              const on = !excluded.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleChannel(c)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors',
                    on
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'text-muted-foreground line-through hover:bg-muted'
                  )}
                >
                  <Icon className="size-3.5" />
                  {campaignChannelLabels[c]}
                  {!isEdit && ` · ${reachable(c)}`}
                </button>
              );
            })}
            {needsSetup.map((c) => {
              const Icon = CHANNEL_ICON[c];
              return (
                <Link
                  key={c}
                  to={routes.campaigns}
                  className="flex items-center gap-1.5 rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Icon className="size-3.5" />
                  Set up {campaignChannelLabels[c]}
                </Link>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Each person is reached on the channels they've agreed to.
          </p>
        </div>

        {/* Email card — Subject + Message + Write with AI (symmetrical). */}
        {emailActive && (
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MailIcon className="size-4" />
              </span>
              <span className="font-semibold">Email</span>
            </div>

            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 p-2 sm:flex-row sm:items-center dark:border-violet-900 dark:bg-violet-950/20">
              <Input
                value={emailPrompt}
                onChange={(e) => setEmailPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void draftWithAI(
                      'email',
                      emailPrompt,
                      () => setBody(''),
                      (t) => setBody((b) => b + t)
                    );
                  }
                }}
                placeholder="Describe your offer, e.g. 20% off lip filler this month"
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <Button
                type="button"
                size="sm"
                disabled={draftingChannel !== null || !emailPrompt.trim()}
                onClick={() =>
                  void draftWithAI(
                    'email',
                    emailPrompt,
                    () => setBody(''),
                    (t) => setBody((b) => b + t)
                  )
                }
                className="shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:opacity-90"
              >
                <SparklesIcon
                  className={cn(
                    'size-4',
                    draftingChannel === 'email' && 'animate-pulse'
                  )}
                />
                {draftingChannel === 'email' ? 'Writing…' : 'Write with AI'}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="composer-subject"
                className="flex items-center gap-1.5"
              >
                <MailIcon className="size-4 text-muted-foreground" />
                {L.subject}
              </Label>
              <Input
                id="composer-subject"
                value={subject}
                onChange={(e) => {
                  setSubjectTouched(true);
                  setSubject(e.target.value);
                }}
                placeholder="Your subject line"
              />
            </div>

            <div className="space-y-1.5">
              <Label
                htmlFor="composer-body"
                className="flex items-center gap-1.5"
              >
                <PenLineIcon className="size-4 text-muted-foreground" />
                {L.body}
              </Label>
              <Textarea
                id="composer-body"
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hi {{firstName|there}}, …"
                className={cn(
                  draftingChannel === 'email' && 'ring-2 ring-violet-300'
                )}
              />
            </div>

            {/* Opt-out hard gate: always shipped, never editable. */}
            <p className="text-xs text-muted-foreground">
              A one-click unsubscribe link is added to every email
              automatically.
            </p>
          </div>
        )}

        {/* WhatsApp card — single Message field ({{2}}) + Write with AI. */}
        {whatsappActive && (
          <div className="space-y-4 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MessageCircleIcon className="size-4" />
              </span>
              <span className="font-semibold">WhatsApp</span>
            </div>

            {showWaSetup && (
              <div className="space-y-2 rounded-lg border border-dashed p-3">
                <p className="text-sm text-muted-foreground">
                  Set up WhatsApp messaging to send this on WhatsApp too. We'll
                  register your approved message template with Meta.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={isEnsuring}
                  onClick={() => ensureTemplate()}
                >
                  <MessageCircleIcon className="size-4" />
                  {isEnsuring ? 'Setting up…' : 'Set up WhatsApp messaging'}
                </Button>
              </div>
            )}

            {showWaPending && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-400">
                <ClockIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  WhatsApp will start sending once Meta approves your template
                  (up to 24 hours). Your email goes out now either way.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-violet-300 bg-violet-50/50 p-2 sm:flex-row sm:items-center dark:border-violet-900 dark:bg-violet-950/20">
              <Input
                value={waPrompt}
                onChange={(e) => setWaPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void draftWithAI(
                      'whatsapp',
                      waPrompt,
                      () => setWaMessage(''),
                      (t) => setWaMessage((m) => m + t)
                    );
                  }
                }}
                placeholder="Describe your offer, e.g. 20% off lip filler this month"
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
              <Button
                type="button"
                size="sm"
                disabled={draftingChannel !== null || !waPrompt.trim()}
                onClick={() =>
                  void draftWithAI(
                    'whatsapp',
                    waPrompt,
                    () => setWaMessage(''),
                    (t) => setWaMessage((m) => m + t)
                  )
                }
                className="shrink-0 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white hover:opacity-90"
              >
                <SparklesIcon
                  className={cn(
                    'size-4',
                    draftingChannel === 'whatsapp' && 'animate-pulse'
                  )}
                />
                {draftingChannel === 'whatsapp' ? 'Writing…' : 'Write with AI'}
              </Button>
            </div>

            {/* {{1}} is auto — shown as a chip, never an input. */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-muted-foreground text-xs">
              <UserIcon className="size-3.5" />
              Personalized with first name
            </span>

            <div className="space-y-1.5">
              <Label
                htmlFor="composer-wa-message"
                className="flex items-center gap-1.5"
              >
                <PenLineIcon className="size-4 text-muted-foreground" />
                WhatsApp message
              </Label>
              <Textarea
                id="composer-wa-message"
                rows={6}
                value={waMessage}
                onChange={(e) => setWaMessage(e.target.value)}
                placeholder="Your appointment is confirmed for…"
                className={cn(
                  draftingChannel === 'whatsapp' && 'ring-2 ring-violet-300'
                )}
              />
            </div>

            {/* Opt-out hard gate: part of the template, never editable. */}
            <p className="text-xs text-muted-foreground">
              “Reply STOP to unsubscribe.” is added to every WhatsApp message
              automatically.
            </p>
          </div>
        )}

        {/* Send (create) / Save (edit) */}
        {isEdit ? (
          <Button
            size="lg"
            className="w-full"
            disabled={!canSave || isSavingEdit}
            onClick={() => void handleSaveEdit()}
          >
            <SendIcon className="size-4" />
            {isSavingEdit ? 'Saving…' : 'Save changes'}
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full"
            disabled={!canSend}
            onClick={() => setConfirmOpen(true)}
          >
            <SendIcon className="size-4" />
            Send to {reachableTotal}{' '}
            {reachableTotal === 1 ? 'person' : 'people'}
          </Button>
        )}
      </div>

      {/* ── Live preview ─────────────────────────────────────────────────── */}
      <div className="space-y-3 lg:sticky lg:top-6 lg:self-start">
        <p className="font-medium text-sm">Live preview</p>
        {previewPane}
      </div>

      {/* Confirm — the same preview components, not text snippets. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Ready to send?</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">To</span>
              <span className="font-medium">
                {audience.label} · {reachableTotal}{' '}
                {reachableTotal === 1 ? 'person' : 'people'}
              </span>
            </div>
            <div className="flex items-center justify-between border-b pb-2">
              <span className="text-muted-foreground">By</span>
              <span className="flex gap-3 font-medium">
                {activeChannels.map((c) => (
                  <span key={c}>
                    {campaignChannelLabels[c]} · {reachable(c)}
                  </span>
                ))}
              </span>
            </div>
            {previewPane}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSending}>
              Keep editing
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSending}
              onClick={(e) => {
                e.preventDefault();
                const waIntent = whatsappActive
                  ? buildWhatsappIntent()
                  : undefined;
                sendCampaign({
                  audience: {
                    label: audience.label,
                    filter: audience.filter,
                    segmentId: audience.segmentId,
                  },
                  channels: activeChannels,
                  subject,
                  body,
                  ...(waIntent ? { whatsappTemplate: waIntent } : {}),
                });
              }}
            >
              {isSending ? 'Sending…' : 'Send now'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Advanced audience builder, one level down */}
      <Sheet open={builderOpen} onOpenChange={setBuilderOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Build an audience</SheetTitle>
            <SheetDescription>
              Filter by status, source, or tags. Saved audiences appear next to
              the quick picks.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-8">
            <SegmentBuilder onCreated={onSegmentCreated} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
