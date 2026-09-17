'use client';

/**
 * §21 — clinic data export, and GDPR erasure.
 *
 * ## Two screens, because they are two different promises
 *
 * Export says "this is your data, take a copy whenever you like, no fee and no
 * approval". Erasure says "this person is asking to be removed, and some of her
 * record legally cannot be". Running them down one page put a red danger zone
 * under a routine download and made the download feel dangerous.
 *
 * ## "Permanently removes all data" is not true, so we do not say it
 *
 * Financial records are kept six years for HMRC; treatment records eight years
 * under indemnity and medicines traceability; consent forms for the life of the
 * record. The erasure screen states what goes and what stays, side by side,
 * before the typed-name confirmation — because the clinic has to be able to
 * answer the patient, and "we deleted everything" is an answer that gets them
 * sued.
 */

import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  EXPORT_DATASETS,
  EXPORT_HISTORY,
  type ExportStatus,
  GDPR_ERASED,
  GDPR_PATIENTS,
  GDPR_RETAINED,
  type GdprPatient,
} from './mock';

type ViewId = 'export' | 'erase';

const VIEWS = [
  { id: 'export', label: 'Export' },
  { id: 'erase', label: 'Erase a patient' },
];

const STATUS_VARIANT: Record<
  ExportStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  queued: 'outline',
  preparing: 'secondary',
  ready: 'default',
  expired: 'outline',
};

export function WfDataPrivacy({ embedded }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<ViewId>('export');

  const body = <>{view === 'export' ? <Export /> : <Erase />}</>;

  // Embedded inside Consent & privacy: the host page owns the frame and the
  // page header, so this contributes only its content.
  if (embedded) {
    return body;
  }

  return (
    <WfFrame
      name="Data & privacy"
      location="Settings › Data & privacy"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="Export and erasure are separate screens">
            One is a routine download the clinic owns outright; the other
            destroys a patient record. A danger zone at the bottom of a download
            page makes the download feel like a risk.
          </WfPoint>
          <WfPoint title="Erased and retained sit side by side">
            The clinic has to answer the patient. “Everything is gone” is false
            and actionable; “your name, photos and notes are gone, your invoices
            survive as Patient #4471 for six years” is the truth and is what the
            screen shows.
          </WfPoint>
          <WfPoint title="Blockers are on the row, before you choose">
            An outstanding balance or a future booking stops erasure. Finding
            that out after typing the patient’s name to confirm is a worse
            experience than never being offered it.
          </WfPoint>
          <WfPoint title="Export history exists because exports are slow">
            6.7 GB of photos takes 25 minutes. Without a history the owner
            re-requests, and one export at a time is a real constraint that has
            to be visible.
          </WfPoint>
          <WfPoint title="Prerequisite">
            §21.1 requires re-authentication on download. The link carries an
            entire patient photo archive, and possession of a link is not
            authentication.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Data & privacy"
        description="Your data is yours. Export it whenever you like — no approval, no fee."
      >
        {body}
      </DashboardPage>
    </WfFrame>
  );
}

/* ---------------------------------------------------------------- export -- */

function Export() {
  const [selected, setSelected] = useState<string[]>(['clients', 'treatments']);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="divide-y rounded-xl border">
          {EXPORT_DATASETS.map((dataset) => (
            <Label
              key={dataset.id}
              className="flex items-start gap-4 px-5 py-4 font-normal"
            >
              <Checkbox
                checked={selected.includes(dataset.id)}
                onCheckedChange={() => toggle(dataset.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-sm">
                  {dataset.label}
                </span>
                <span className="block text-muted-foreground text-sm">
                  {dataset.detail}
                </span>
              </span>
              <span className="shrink-0 text-muted-foreground text-sm tabular-nums">
                {dataset.format} · {dataset.size}
              </span>
            </Label>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={selected.length === 0}>
            Request {selected.length} export
            {selected.length === 1 ? '' : 's'}
          </Button>
          <span className="text-muted-foreground text-sm">
            You will get an email with a download link. It expires after seven
            days and asks you to sign in again.
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Recent exports</h2>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[170px]">Requested</TableHead>
                <TableHead>Contents</TableHead>
                <TableHead className="w-[120px]">Status</TableHead>
                <TableHead>What is happening</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {EXPORT_HISTORY.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="tabular-nums">
                    {row.requestedAt}
                    <span className="block text-muted-foreground text-xs">
                      {row.requestedBy}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.datasets}
                    <span className="block text-xs tabular-nums">
                      {row.size}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>
                      {row.status === 'ready' ? 'Ready' : null}
                      {row.status === 'preparing' ? 'Preparing' : null}
                      {row.status === 'queued' ? 'Queued' : null}
                      {row.status === 'expired' ? 'Expired' : null}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.statusDetail}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

/* ----------------------------------------------------------------- erase -- */

function Erase() {
  const [patient, setPatient] = useState<GdprPatient>(GDPR_PATIENTS[0]);
  const blocked = patient.blockers.length > 0;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="font-semibold text-lg">Who is asking</h2>
        <Input
          placeholder="Search by name, phone or email"
          className="max-w-md"
        />
        <div className="divide-y rounded-xl border">
          {GDPR_PATIENTS.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => setPatient(row)}
              className={cn(
                'block w-full px-5 py-4 text-left transition-colors',
                row.id === patient.id ? 'bg-muted/60' : 'hover:bg-muted/40'
              )}
            >
              <span className="block font-medium text-sm">{row.name}</span>
              <span className="block text-muted-foreground text-sm">
                {row.secondary}
              </span>
              {/* On the row, so you know before you choose. */}
              {row.blockers.map((blocker) => (
                <span
                  key={blocker}
                  className="mt-1.5 block text-destructive text-sm"
                >
                  {blocker}
                </span>
              ))}
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border p-5">
          <h3 className="font-semibold">Erased permanently</h3>
          <ul className="mt-3 space-y-2 text-muted-foreground text-sm">
            {GDPR_ERASED.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border p-5">
          <h3 className="font-semibold">Kept, with her name removed</h3>
          <ul className="mt-3 space-y-3 text-sm">
            {GDPR_RETAINED.map((item) => (
              <li key={item.label}>
                <p className="font-medium">{item.label}</p>
                <p className="text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-destructive/40 p-5">
        <h3 className="font-semibold">Erase {patient.name}</h3>
        {blocked ? (
          <p className="text-destructive text-sm">
            {patient.blockers.join(' · ')}. Clear this first — erasure would
            destroy the record the balance is owed against.
          </p>
        ) : (
          <p className="text-muted-foreground text-sm">
            This cannot be undone, and it takes effect immediately across every
            device.
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2">
            <Label htmlFor="erase-confirm">
              Type <span className="font-semibold">{patient.name}</span> to
              confirm
            </Label>
            <Input
              id="erase-confirm"
              className="w-[280px]"
              disabled={blocked}
              placeholder={patient.name}
            />
          </div>
          <Button variant="destructive" disabled>
            Erase this patient
          </Button>
        </div>
      </section>
    </div>
  );
}
