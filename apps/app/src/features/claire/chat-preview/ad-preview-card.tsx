'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { trackRecommendationEdited } from '../telemetry';
import { CreativePreview } from './creative-preview';
import { usePublishAd } from './use-publish-ad';
import { useSaveAdDraft } from './use-save-ad-draft';
import { useUpdatePendingAd } from './use-update-pending-ad';

export interface AdPreviewCardState {
  draftId: string;
  name: string;
  headline: string | null;
  primaryText: string | null;
  videoId: string | null;
}

interface AdPreviewCardProps {
  draft: AdPreviewCardState;
}

/**
 * Window 7 — minimal preview card rendered in the chat thread when
 * Claire calls `show_ad_preview`. Editable fields: headline + caption
 * (primaryText). Anything else stays as Claire configured it; owners
 * who want broader edits use `/ads/new` (Decision #14).
 */
export function AdPreviewCard({ draft }: AdPreviewCardProps) {
  const [headline, setHeadline] = useState(draft.headline ?? '');
  const [primaryText, setPrimaryText] = useState(draft.primaryText ?? '');
  const [published, setPublished] = useState(false);

  // Track which fields were edited away from Claire's defaults so we can
  // fire a single `edited` event when the user commits via save/publish.
  // Initial values come from the snapshot — anything different counts.
  const initialHeadlineRef = useRef(draft.headline ?? '');
  const initialPrimaryTextRef = useRef(draft.primaryText ?? '');
  const emitEditedIfDirty = () => {
    const editedFields: string[] = [];
    if (headline !== initialHeadlineRef.current) editedFields.push('headline');
    if (primaryText !== initialPrimaryTextRef.current)
      editedFields.push('primaryText');
    if (editedFields.length === 0) return;
    trackRecommendationEdited({
      surface: 'chat',
      kind: 'ad_flow_service_pick',
      rankedServiceId: draft.draftId,
      rank: 1,
      acceptedAtRank: 1,
      editedFields,
    });
  };

  const updatePending = useUpdatePendingAd(draft.draftId);
  const saveDraft = useSaveAdDraft(draft.draftId);
  const publishAd = usePublishAd(draft.draftId, {
    onSuccess: () => setPublished(true),
  });

  const isBusy = saveDraft.isPending || publishAd.isPending;

  const handleSave = () => {
    emitEditedIfDirty();
    saveDraft.mutate({ headline, primaryText });
  };

  const handlePublish = () => {
    emitEditedIfDirty();
    publishAd.mutate({ headline, primaryText });
  };

  return (
    <Card data-testid="ad-preview-card" className="max-w-md my-3 bg-card">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-medium truncate">{draft.name}</h3>
        </div>

        <CreativePreview videoId={draft.videoId} />

        <Field>
          <FieldLabel htmlFor={`ad-preview-headline-${draft.draftId}`}>
            Headline
          </FieldLabel>
          <Input
            id={`ad-preview-headline-${draft.draftId}`}
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            onBlur={() => updatePending.mutate({ headline })}
            maxLength={40}
            disabled={published}
            aria-invalid={false}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor={`ad-preview-caption-${draft.draftId}`}>
            Caption
          </FieldLabel>
          <Textarea
            id={`ad-preview-caption-${draft.draftId}`}
            value={primaryText}
            onChange={(e) => setPrimaryText(e.target.value)}
            onBlur={() => updatePending.mutate({ primaryText })}
            rows={4}
            maxLength={500}
            disabled={published}
            aria-invalid={false}
          />
        </Field>
      </CardContent>
      <CardFooter className="flex gap-2 justify-end p-4 pt-0">
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={isBusy || published}
        >
          {saveDraft.isPending ? 'Saving…' : 'Save draft'}
        </Button>
        <Button onClick={handlePublish} disabled={isBusy || published}>
          {published
            ? 'Published'
            : publishAd.isPending
              ? 'Publishing…'
              : 'Publish'}
        </Button>
      </CardFooter>
    </Card>
  );
}
