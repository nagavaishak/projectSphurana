import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpIcon,
  CheckCircle2,
  Loader2,
  MessageCircleDashedIcon,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from '@/components/ui/input-group';
import { Message, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller';

import { queryKeys } from '@/lib/query-keys';

import { useSaveContentRule } from '@/features/assistant/api/use-content-rules';

import {
  useBatchItemClips,
  useBatchItemMessages,
  useRegenerateBatchItem,
  useReviewTurn,
  useUpdateBatchItemCaption,
} from '../../api';
import type {
  ContentItemWithAsset,
  PendingRegenerateEdit,
  SuggestedContentRule,
} from '../../types';
import { ClipListEditor } from '../clip-list-editor';
import { assetIsRendering } from './lib';

/** "slide 2 → shorter headline", or "remove slide 3". */
function describeEdit(edit: PendingRegenerateEdit): string {
  const where =
    edit.slideIndex === null
      ? 'the whole thing'
      : `slide ${edit.slideIndex + 1}`;
  return edit.op === 'remove'
    ? `Remove ${where}`
    : `${where.charAt(0).toUpperCase()}${where.slice(1)} — ${edit.note ?? ''}`;
}

/**
 * Quick actions — the instructions people type over and over. They go through
 * the same path as typed text, so there is one code path and one thread entry
 * either way.
 *
 * These occupy the slot the shadcn chat pattern gives to an attachments menu.
 * Attachments would be a lie here: this thread edits words on a post that is
 * already rendered, so there is nothing to attach.
 */
const QUICK_ACTIONS = [
  'Shorter',
  'Less salesy',
  'Mention the price',
  'Add a clear next step',
] as const;

interface ClaireThreadProps {
  item: ContentItemWithAsset;
  batchId: string | undefined;
  /** Disabled once the post is decided — there is nothing left to edit. */
  disabled?: boolean;
}

/**
 * The per-post review thread.
 *
 * Scoped to ONE item on purpose. Switching posts swaps the thread rather than
 * appending to a running log: a rewrite that can see post 1's copy while
 * editing post 3 borrows from it, and a single scrolling transcript makes
 * "what did I ask for on this post" unanswerable by post eight. What DOES
 * persist across posts is the instruction itself, promoted to a standing rule
 * via the suggestion below.
 *
 * Built on `MessageScroller` so the thread behaves like a real chat: it pins to
 * the newest turn while a rewrite lands, backs off the moment the reader
 * scrolls up to compare an earlier version, and offers the jump-to-latest
 * button instead of yanking them back.
 *
 * Unlike the `useChat` pattern this composition usually carries, a rewrite is
 * one request that returns the whole thread — there is no token stream to
 * follow, so the transport is the mutation and `isRefining` stands in for
 * streaming status.
 */
export function ClaireThread({ item, batchId, disabled }: ClaireThreadProps) {
  const [draft, setDraft] = useState('');
  const [suggestion, setSuggestion] = useState<SuggestedContentRule | null>(
    null
  );
  // A proposal Claire made this session. Seeded from the SLOT below so it also
  // survives a refresh — the reply points at a button, and a button the text
  // promises must outlive the page that showed it.
  const [proposal, setProposal] = useState<PendingRegenerateEdit[] | null>(
    null
  );
  // The proposal, kept after it is spent.
  //
  // Pressing Regenerate used to unmount the bubble outright: the button, the
  // list of what it was about to do, and the only acknowledgement of the click
  // all went at once, leaving the thread looking like nothing had happened.
  // The proposal stays put and the button goes disabled instead.
  const [spentProposal, setSpentProposal] = useState<
    PendingRegenerateEdit[] | null
  >(null);

  const { messages } = useBatchItemMessages(item.id);
  // Staged clip / on-screen-text edits, and the button that commits them.
  //
  // This lives HERE, not in a filmstrip under the post, because staging happens
  // in conversation: Claire says "the first clip will be swapped on the next
  // render" and the way to make that true has to be within reach of the
  // sentence that promised it. Put somewhere else on the page, the reply reads
  // as a statement of fact about something that already happened — which is
  // exactly how it read.
  //
  // Video-only: clips and on-screen text belong to a rendered video, and a
  // graphic post can never stage either. Passing '' leaves the query disabled
  // rather than firing a request per graphic that can only come back empty.
  const { hasStagedEdits, renderCount } = useBatchItemClips(
    item.kind === 'video' ? item.id : ''
  );
  // The commit was made, kept after `hasStagedEdits` clears.
  //
  // Applying used to unmount the whole bubble — the control vanished mid-click
  // and took the only confirmation with it, which reads as "did that register?"
  // rather than "that's rendering". The card stays on screen instead, spent.
  // Applying itself belongs to the card now; this is only what keeps it
  // mounted afterwards.
  const [applied, setApplied] = useState(false);
  // "Done" needs the render to have been SEEN in flight, not merely to be
  // absent. The apply resolves a beat before the refetched item reports
  // `rendering`, and reading that gap as completion flashed "Re-rendered" over
  // a video that had not started.
  const [sawReRender, setSawReRender] = useState(false);
  // A re-roll hands off to the same asset render an approved edit does, so the
  // spent button below tracks the ASSET, not this mutation.
  const { regenerateBatchItem, isRegenerating } = useRegenerateBatchItem({
    onSuccess: () => {
      setSpentProposal(proposal);
      setProposal(null);
    },
  });
  const { saveContentRule, isSaving } = useSaveContentRule({
    onSuccess: () => setSuggestion(null),
  });
  const { updateCaption } = useUpdateBatchItemCaption();
  const queryClient = useQueryClient();
  const { refineCaption, isRefining, isError, error, reset } = useReviewTurn({
    onSuccess: (result) => {
      setSuggestion(result.suggestedRule);
      setProposal(result.pendingRegenerate);
      // A fresh proposal supersedes the last one — the bubble goes back to
      // being a live Regenerate rather than a spent one.
      if (result.pendingRegenerate?.length) {
        setSpentProposal(null);
        setSawReRender(false);
      }
      // A turn that staged a clip or text change has to refresh the filmstrip
      // below the post — that is where the change is shown and committed.
      if (result.stagedEdits) {
        // A fresh stage supersedes the last commit — the bubble goes back to
        // being a live Apply rather than a spent one.
        setApplied(false);
        setSawReRender(false);
        void queryClient.invalidateQueries({
          queryKey: queryKeys.contentBatches.itemClips(item.id),
        });
      }
    },
  });

  // A suggestion belongs to the turn that produced it — carrying one across a
  // post switch would offer to make a standing rule out of something the owner
  // said about a different post.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on item identity only
  useEffect(() => {
    setSuggestion(null);
    setDraft('');
    setProposal(null);
    setSpentProposal(null);
    setApplied(false);
    setSawReRender(false);
    reset();
  }, [item.id]);

  const isBusy = isRefining;

  // Rendering is the state the Apply button hands off to, so the spent button
  // tracks the asset rather than the mutation: the request settles in a moment,
  // the render it started takes a minute or two.
  const isReRendering = assetIsRendering(item);
  const handedOff = applied || spentProposal !== null;
  useEffect(() => {
    if (handedOff && isReRendering) setSawReRender(true);
  }, [handedOff, isReRendering]);
  /** The render this thread kicked off has been seen through to the end. */
  const renderSettled = sawReRender && !isReRendering;
  const regenerateDone = spentProposal !== null && renderSettled;
  const showCommit = hasStagedEdits || applied;
  const shownProposal = proposal?.length ? proposal : spentProposal;

  const send = (instruction: string) => {
    const trimmed = instruction.trim();
    if (!trimmed || isBusy || disabled) return;
    setDraft('');
    setSuggestion(null);
    refineCaption({ itemId: item.id, instruction: trimmed });
  };

  return (
    <MessageScrollerProvider>
      <Card className="h-full w-full gap-0 rounded-none border-0 bg-transparent shadow-none">
        <CardHeader className="gap-1 border-b">
          <CardTitle className="text-sm">Claire</CardTitle>
          <CardDescription className="text-xs">
            Editing this post
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 overflow-hidden p-0">
          {messages.length === 0 && !isBusy ? (
            <Empty className="h-full">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessageCircleDashedIcon />
                </EmptyMedia>
                <EmptyTitle>I wrote this one from your plan</EmptyTitle>
                <EmptyDescription>
                  Anything you&apos;d change before it goes out?
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <MessageScroller>
              <MessageScrollerViewport>
                <MessageScrollerContent
                  aria-busy={isBusy}
                  className="gap-4 p-3"
                >
                  {messages.map((message) => (
                    <MessageScrollerItem
                      key={message.id}
                      // Anchor on the owner's turn so the reply settles into
                      // view under what they asked, instead of snapping to the
                      // bottom of the document.
                      scrollAnchor={message.role === 'user'}
                    >
                      <Message
                        align={message.role === 'user' ? 'end' : 'start'}
                      >
                        <MessageContent>
                          <Bubble
                            variant={
                              message.role === 'user' ? 'default' : 'muted'
                            }
                            align={message.role === 'user' ? 'end' : 'start'}
                          >
                            <BubbleContent className="whitespace-pre-wrap">
                              {message.content}
                            </BubbleContent>
                          </Bubble>

                          {/* Every version stays one click away, so trying
                              something is cheap — fear of losing the copy you
                              already had is the main reason people don't ask. */}
                          {message.role === 'assistant' &&
                          message.captionSnapshot ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              disabled={
                                disabled ||
                                message.captionSnapshot === item.caption
                              }
                              onClick={() =>
                                updateCaption({
                                  itemId: item.id,
                                  caption: message.captionSnapshot as string,
                                })
                              }
                              className="h-6 w-fit gap-1 px-1 text-xs text-muted-foreground"
                            >
                              <RotateCcw className="size-3" />
                              {message.captionSnapshot === item.caption
                                ? 'Current version'
                                : 'Restore this version'}
                            </Button>
                          ) : null}
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ))}

                  {isBusy ? (
                    <MessageScrollerItem>
                      <Message align="start">
                        <MessageContent>
                          <Bubble variant="muted">
                            <BubbleContent className="text-muted-foreground">
                              Rewriting…
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : null}

                  {isError ? (
                    <MessageScrollerItem>
                      <Message align="start">
                        <MessageContent>
                          <Bubble variant="destructive">
                            <BubbleContent>
                              {error?.message || "That didn't go through."}
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : null}

                  {/* A re-roll Claire proposed, waiting on the owner.

                      This is how a GRAPHIC changes its printed words: they are
                      pixels, not fields, so the only way to change them is to
                      generate again. Nothing has been spent until this is
                      pressed — which is why the reply says "ready", not
                      "done". */}
                  {shownProposal?.length ? (
                    <MessageScrollerItem>
                      <Message align="start">
                        <MessageContent>
                          <Bubble variant="outline">
                            <BubbleContent className="flex flex-col gap-2">
                              <span className="text-muted-foreground">
                                {spentProposal
                                  ? 'Sent to regenerate:'
                                  : 'Ready to regenerate:'}
                              </span>
                              <ul className="flex flex-col gap-0.5">
                                {shownProposal.map((edit) => (
                                  <li
                                    key={`${edit.slideIndex}-${edit.op}-${edit.note ?? ''}`}
                                    className="text-xs"
                                  >
                                    · {describeEdit(edit)}
                                  </li>
                                ))}
                              </ul>
                              {/* Stays put once spent. A disabled button that
                                  says what it did is the receipt for the click
                                  — removing it leaves the owner unsure the
                                  press landed and asking Claire for the same
                                  re-roll a second time, which costs a second
                                  render. */}
                              <Button
                                type="button"
                                size="sm"
                                className="w-fit gap-1.5"
                                disabled={
                                  disabled || isRegenerating || !!spentProposal
                                }
                                onClick={() =>
                                  regenerateBatchItem({
                                    itemId: item.id,
                                    edits: shownProposal,
                                  })
                                }
                              >
                                {regenerateDone ? (
                                  <CheckCircle2 className="size-3.5" />
                                ) : isRegenerating || spentProposal ? (
                                  <Loader2 className="size-3.5 animate-spin" />
                                ) : (
                                  <Sparkles className="size-3.5" />
                                )}
                                {!spentProposal
                                  ? 'Regenerate'
                                  : regenerateDone
                                    ? 'Regenerated'
                                    : 'Regenerating…'}
                              </Button>
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <CheckCircle2 className="size-3" />
                                {!spentProposal
                                  ? 'Nothing has changed yet.'
                                  : regenerateDone
                                    ? 'The new version is on the post.'
                                    : 'Takes a minute or two.'}
                              </span>
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : null}

                  {/* The clips, editable, with the commit attached.

                      Rendered last so it sits directly under the turn that
                      staged the change — the scroller pins to the newest turn,
                      so the promise and the thing that keeps it arrive
                      together.

                      This IS the Apply button that used to live here. It was a
                      button and a sentence describing what it would do; now
                      the owner sees the actual list, can drag it, and approves
                      the list rather than a description of it. Everything
                      staged still lands as ONE render — "swap clip 1, drop
                      clip 2, fix the text" costs one rather than three — and
                      the owner still chooses when that is paid. */}
                  {showCommit ? (
                    <MessageScrollerItem>
                      <Message align="start">
                        <MessageContent>
                          <ClipListEditor
                            itemId={item.id}
                            title="Clips in this post"
                            renderCount={renderCount}
                            onApplied={() => setApplied(true)}
                          />
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : null}

                  {/* Opt-in, never automatic. A rule silently applied to every
                      future post for the whole business is a far worse failure
                      than one the owner has to tap. */}
                  {suggestion ? (
                    <MessageScrollerItem>
                      <Message align="start">
                        <MessageContent>
                          <Bubble variant="outline">
                            <BubbleContent className="flex flex-col gap-2">
                              <span className="text-muted-foreground">
                                Want that on every future post?
                              </span>
                              <span className="font-medium">
                                {suggestion.content}
                              </span>
                              <span className="flex gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={isSaving}
                                  onClick={() =>
                                    saveContentRule({
                                      title: suggestion.title,
                                      content: suggestion.content,
                                      batchId,
                                    })
                                  }
                                >
                                  Always do this
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setSuggestion(null)}
                                >
                                  Just this post
                                </Button>
                              </span>
                            </BubbleContent>
                          </Bubble>
                        </MessageContent>
                      </Message>
                    </MessageScrollerItem>
                  ) : null}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton />
            </MessageScroller>
          )}
        </CardContent>

        <CardFooter className="flex-col gap-2 border-t pt-3">
          <div className="flex w-full flex-wrap gap-1.5">
            {QUICK_ACTIONS.map((action) => (
              <Button
                key={action}
                type="button"
                variant="outline"
                size="sm"
                disabled={isBusy || disabled}
                onClick={() => send(action)}
                className="h-7 rounded-full px-2.5 text-xs font-normal"
              >
                {action}
              </Button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
            className="w-full"
          >
            <InputGroup>
              <InputGroupTextarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                disabled={isBusy || disabled}
                placeholder={
                  disabled
                    ? 'This post has already been decided'
                    : 'Tell Claire what to change…'
                }
                aria-label="Tell Claire what to change"
              />
              <InputGroupAddon align="block-end" className="pt-1">
                <span className="text-xs text-muted-foreground">
                  Changes apply to this post only.
                </span>
                <InputGroupButton
                  type="submit"
                  variant="default"
                  size="icon-sm"
                  disabled={!draft.trim() || isBusy || disabled}
                  className="ml-auto"
                >
                  <ArrowUpIcon />
                  <span className="sr-only">Send</span>
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </form>
        </CardFooter>
      </Card>
    </MessageScrollerProvider>
  );
}
