'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useResolvedRoutes } from '@/lib/use-routes';
import {
  leadSourceLabels,
  leadSourceValues,
  leadStatusLabels,
  leadStatusValues,
} from '@borradh-workspace/labels';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import {
  type Segment,
  buildSegmentFilter,
  useCreateSegment,
  usePreviewSegment,
} from '../api';

const toggle = (arr: string[], v: string) =>
  arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

/** One-tap audiences so non-technical users skip building filters by hand. */
const QUICK_PICKS: {
  label: string;
  name: string;
  status?: string[];
  source?: string[];
}[] = [
  { label: 'Everyone', name: 'Everyone' },
  { label: 'New leads', name: 'New leads', status: ['new'] },
  {
    label: 'Engaged',
    name: 'Engaged leads',
    status: ['contacted'],
  },
  { label: 'Booked customers', name: 'Booked customers', status: ['booked'] },
  {
    label: 'From Instagram',
    name: 'Instagram leads',
    source: ['instagram'],
  },
];

interface SegmentBuilderProps {
  /**
   * Called with the saved segment instead of navigating — used when the
   * builder is embedded in the composer's audience drawer.
   */
  onCreated?: (segment: Segment) => void;
}

export function SegmentBuilder({ onCreated }: SegmentBuilderProps = {}) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const { preview, data: previewData, isPreviewing } = usePreviewSegment();
  const { createSegment, isCreating } = useCreateSegment({
    onSuccess: (segment) =>
      onCreated ? onCreated(segment) : navigate({ to: routes.campaigns }),
  });

  const [name, setName] = useState('');
  const [status, setStatus] = useState<string[]>([]);
  const [source, setSource] = useState<string[]>([]);
  const [tagsRaw, setTagsRaw] = useState('');
  const [consentEmail, setConsentEmail] = useState(false);
  const [consentSms, setConsentSms] = useState(false);
  const [isDynamic, setIsDynamic] = useState(true);

  // Assemble the audience filter through the shared builder so the composer's
  // send flow and this builder can never diverge.
  const buildFilter = () =>
    buildSegmentFilter({ status, source, tagsRaw, consentEmail, consentSms });

  const applyPreset = (p: (typeof QUICK_PICKS)[number]) => {
    setName(p.name);
    setStatus(p.status ?? []);
    setSource(p.source ?? []);
    setTagsRaw('');
    setConsentEmail(false);
    setConsentSms(false);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <form
        className="space-y-6"
        onSubmit={(e) => {
          e.preventDefault();
          createSegment({ name, filter: buildFilter(), isDynamic });
        }}
      >
        <div className="space-y-2">
          <Label>Quick picks</Label>
          <div className="flex flex-wrap gap-2">
            {QUICK_PICKS.map((p) => (
              <Button
                key={p.label}
                type="button"
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={() => applyPreset(p)}
              >
                {p.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="seg-name">Segment name</Label>
          <Input
            id="seg-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. New Instagram leads, last 30 days"
            required
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Lead status</legend>
          <div className="flex flex-wrap gap-3">
            {leadStatusValues.map((s) => (
              <label
                key={s}
                htmlFor={`status-${s}`}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  id={`status-${s}`}
                  checked={status.includes(s)}
                  onCheckedChange={() => setStatus((p) => toggle(p, s))}
                />
                {leadStatusLabels[s]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Lead source</legend>
          <div className="flex flex-wrap gap-3">
            {leadSourceValues.map((s) => (
              <label
                key={s}
                htmlFor={`source-${s}`}
                className="flex items-center gap-2 text-sm"
              >
                <Checkbox
                  id={`source-${s}`}
                  checked={source.includes(s)}
                  onCheckedChange={() => setSource((p) => toggle(p, s))}
                />
                {leadSourceLabels[s]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="space-y-2">
          <Label htmlFor="seg-tags">Tags (comma-separated)</Label>
          <Input
            id="seg-tags"
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder="botox, returning, vip"
          />
        </div>

        <div className="space-y-2">
          <span className="text-sm font-medium">Consent</span>
          <div className="flex flex-col gap-2">
            <label
              htmlFor="consent-email"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="consent-email"
                checked={consentEmail}
                onCheckedChange={(c) => setConsentEmail(Boolean(c))}
              />
              Only leads who consented to email
            </label>
            <label
              htmlFor="consent-sms"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="consent-sms"
                checked={consentSms}
                onCheckedChange={(c) => setConsentSms(Boolean(c))}
              />
              Only leads who consented to SMS
            </label>
          </div>
        </div>

        <label htmlFor="is-dynamic" className="flex items-center gap-2 text-sm">
          <Checkbox
            id="is-dynamic"
            checked={isDynamic}
            onCheckedChange={(c) => setIsDynamic(Boolean(c))}
          />
          Keep this segment up to date. New leads that match are included
          automatically when a campaign sends.
        </label>

        <div className="flex gap-2">
          <Button type="submit" disabled={isCreating || !name}>
            {isCreating ? 'Saving…' : 'Save segment'}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPreviewing}
            onClick={() => preview({ filterJson: buildFilter() })}
          >
            {isPreviewing ? 'Counting…' : 'Preview reach'}
          </Button>
        </div>
      </form>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Estimated reach</CardTitle>
          <CardDescription>
            How many leads match your filters, and how many you can actually
            reach on each channel.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {previewData ? (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Matched leads</span>
                <span className="font-medium">{previewData.total}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Reachable (any)</span>
                <span className="font-medium">{previewData.reachable}</span>
              </div>
              <hr />
              <div className="flex justify-between">
                <span className="text-muted-foreground">Email</span>
                <span>{previewData.channels.email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">SMS</span>
                <span>{previewData.channels.sms}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">WhatsApp</span>
                <span>{previewData.channels.whatsapp}</span>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">
              Click “Preview reach” to see how many leads match.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
