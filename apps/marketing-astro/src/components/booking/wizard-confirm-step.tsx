'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

import { type WizardConfig, cancellationPolicyText } from './booking-cart';

export interface GuestDetails {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

interface WizardConfirmStepProps {
  config: WizardConfig;
  currencySymbol: string;
  details: GuestDetails;
  onDetailsChange: (details: GuestDetails) => void;
  note: string;
  onNoteChange: (note: string) => void;
}

/**
 * The Review-and-confirm step: the cancellation policy, a "Comments or
 * requests" note (captured through a dialog, matching Fresha), and the guest's
 * contact details (we have no logged-in account, so we collect them here). The
 * primary Confirm action lives in the cart panel.
 */
export function WizardConfirmStep({
  config,
  currencySymbol,
  details,
  onDetailsChange,
  note,
  onNoteChange,
}: WizardConfirmStepProps) {
  const [noteOpen, setNoteOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(note);

  const setField = (key: keyof GuestDetails, value: string) =>
    onDetailsChange({ ...details, [key]: value });

  return (
    <div>
      <h1 className="font-bold text-3xl md:text-4xl">Review and confirm</h1>

      {/* More details */}
      <section className="mt-8">
        <h2 className="font-semibold text-lg">More details</h2>
        <div className="mt-3 rounded-xl border p-5">
          <p className="font-semibold">Cancellation policy</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {cancellationPolicyText(config, currencySymbol)}
          </p>
        </div>
      </section>

      {/* Comments or requests */}
      <section className="mt-8">
        <h2 className="font-semibold text-lg">Comments or requests</h2>
        <div className="mt-3 flex items-center justify-between gap-4 rounded-xl border p-5">
          <p className={note ? 'text-sm' : 'text-sm text-muted-foreground'}>
            {note || "Anything you'd like us to know?"}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraftNote(note);
              setNoteOpen(true);
            }}
          >
            {note ? 'Edit' : 'Add'}
          </Button>
        </div>
      </section>

      {/* Your details */}
      <section className="mt-8">
        <h2 className="font-semibold text-lg">Your details</h2>
        <FieldGroup className="mt-3">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="guest-first-name">
                First name <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                id="guest-first-name"
                required
                aria-required
                value={details.firstName}
                onChange={(e) => setField('firstName', e.target.value)}
                placeholder="Jane"
                autoComplete="given-name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="guest-last-name">Last name</FieldLabel>
              <Input
                id="guest-last-name"
                value={details.lastName}
                onChange={(e) => setField('lastName', e.target.value)}
                placeholder="Doe"
                autoComplete="family-name"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="guest-email">
              Email <span className="text-destructive">*</span>
            </FieldLabel>
            <Input
              id="guest-email"
              type="email"
              required
              aria-required
              value={details.email}
              onChange={(e) => setField('email', e.target.value)}
              placeholder="johndoe@example.com"
              autoComplete="email"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="guest-phone">Phone</FieldLabel>
            <Input
              id="guest-phone"
              type="tel"
              value={details.phone}
              onChange={(e) => setField('phone', e.target.value)}
              placeholder="+353 …"
              autoComplete="tel"
            />
          </Field>
        </FieldGroup>
      </section>

      {/* Add-a-note dialog (Fresha) */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a booking note</DialogTitle>
          </DialogHeader>
          <Textarea
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
            placeholder="Include comments or requests about your booking"
            rows={4}
            maxLength={1000}
          />
          <Button
            className="w-full"
            onClick={() => {
              onNoteChange(draftNote.trim());
              setNoteOpen(false);
            }}
          >
            Add
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
